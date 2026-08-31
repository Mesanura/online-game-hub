import { Client as ColyseusClient } from "@colyseus/sdk";
import type { Room as ClientRoom } from "@colyseus/sdk";
import {
  GAME_ACTION_MESSAGE,
  GAME_ROOM_NAME,
  InMemoryMetricsCollector,
  InMemoryReplayStore,
  InMemoryRoomStore,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  verifyReplay,
} from "@online-game-hub/game-server-runtime";
import type {
  ReplayAction,
  ReplayHeader,
  ReplayStore,
  RuntimeLogEvent,
} from "@online-game-hub/game-server-runtime";
import {
  FakeRuntimeClock,
  TestTicketAuthority,
  createDeterministicRuntimeIdSource,
} from "@online-game-hub/game-server-runtime/testing";
import { resolveGameDefinition } from "@online-game-hub/game-registry/server";
import {
  PROTOCOL_VERSION,
  roomLifecycleStateSchema,
  serverMessageSchema,
} from "@online-game-hub/protocol";
import type {
  GameActionCommand,
  MatchSnapshot,
  RoomControlCommand,
  RoomControlOperation,
  RoomLifecycleState,
  ServerMessage,
} from "@online-game-hub/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGameServer } from "../src/index.js";
import type { GameServerAddress, GameServerApplication } from "../src/index.js";

class ControlledReplayStore implements ReplayStore {
  public failNextAppend = false;
  readonly #delegate = new InMemoryReplayStore();

  public create(replayId: string, header: ReplayHeader): Promise<void> {
    return this.#delegate.create(replayId, header);
  }

  public append(
    replayId: string,
    expectedSequence: number,
    event: ReplayAction,
  ): Promise<void> {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      return Promise.reject(new Error("injected replay append failure"));
    }
    return this.#delegate.append(replayId, expectedSequence, event);
  }

  public complete(
    replayId: string,
    expectedSequence: number,
    finalRngCursor: number,
    outcome: Parameters<ReplayStore["complete"]>[3],
  ): Promise<void> {
    return this.#delegate.complete(
      replayId,
      expectedSequence,
      finalRngCursor,
      outcome,
    );
  }

  public get(replayId: string) {
    return this.#delegate.get(replayId);
  }
}

class MessageInbox {
  readonly #messages: ServerMessage[] = [];
  readonly #waiters: {
    readonly predicate: (message: ServerMessage) => boolean;
    readonly resolve: (message: ServerMessage) => void;
  }[] = [];

  public constructor(room: ClientRoom) {
    room.onMessage<unknown>(SERVER_PROTOCOL_MESSAGE, (raw) => {
      const parsed = serverMessageSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("Server emitted an invalid protocol message.");
      }
      const message = parsed.data;
      const waiterIndex = this.#waiters.findIndex((waiter) =>
        waiter.predicate(message),
      );
      if (waiterIndex === -1) {
        this.#messages.push(message);
        return;
      }
      const [waiter] = this.#waiters.splice(waiterIndex, 1);
      waiter?.resolve(message);
    });
  }

  public next(
    predicate: (message: ServerMessage) => boolean,
    timeoutMilliseconds = 3000,
  ): Promise<ServerMessage> {
    const messageIndex = this.#messages.findIndex(predicate);
    if (messageIndex !== -1) {
      const [message] = this.#messages.splice(messageIndex, 1);
      if (message !== undefined) {
        return Promise.resolve(message);
      }
    }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      this.#waiters.push(waiter);
      const timeout = setTimeout(() => {
        const index = this.#waiters.indexOf(waiter);
        if (index !== -1) {
          this.#waiters.splice(index, 1);
        }
        reject(new Error("Timed out waiting for a server protocol message."));
      }, timeoutMilliseconds);
      waiter.resolve = (message) => {
        clearTimeout(timeout);
        resolve(message);
      };
    });
  }
}

class LifecycleInbox {
  readonly #messages: RoomLifecycleState[] = [];
  readonly #waiters: {
    readonly predicate: (message: RoomLifecycleState) => boolean;
    readonly resolve: (message: RoomLifecycleState) => void;
  }[] = [];

  public constructor(room: ClientRoom) {
    room.onMessage<unknown>(ROOM_CONTROL_MESSAGE, (raw) => {
      const parsed = roomLifecycleStateSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("Server emitted an invalid room lifecycle message.");
      }
      const message = parsed.data;
      const waiterIndex = this.#waiters.findIndex((waiter) =>
        waiter.predicate(message),
      );
      if (waiterIndex === -1) {
        this.#messages.push(message);
        return;
      }
      const [waiter] = this.#waiters.splice(waiterIndex, 1);
      waiter?.resolve(message);
    });
  }

  public next(
    predicate: (message: RoomLifecycleState) => boolean,
    timeoutMilliseconds = 3000,
  ): Promise<RoomLifecycleState> {
    const messageIndex = this.#messages.findIndex(predicate);
    if (messageIndex !== -1) {
      const [message] = this.#messages.splice(messageIndex, 1);
      if (message !== undefined) return Promise.resolve(message);
    }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      this.#waiters.push(waiter);
      const timeout = setTimeout(() => {
        const index = this.#waiters.indexOf(waiter);
        if (index !== -1) this.#waiters.splice(index, 1);
        reject(new Error("Timed out waiting for a room lifecycle message."));
      }, timeoutMilliseconds);
      waiter.resolve = (message) => {
        clearTimeout(timeout);
        resolve(message);
      };
    });
  }
}

function isSnapshot(message: ServerMessage): message is MatchSnapshot {
  return message.type === "match.snapshot";
}

function command(
  commandId: string,
  expectedRevision: number,
  action: unknown,
  roundNumber?: number,
): GameActionCommand {
  return {
    type: "game.action",
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    ...(roundNumber === undefined ? {} : { roundNumber }),
    expectedRevision,
    action,
  };
}

function controlCommand(
  commandId: string,
  operation: RoomControlOperation,
): RoomControlCommand {
  return {
    type: "room.control",
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    operation,
  };
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMilliseconds = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for integration state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe.sequential("authoritative Colyseus Game Server", () => {
  const clock = new FakeRuntimeClock(1_000_000);
  const authority = new TestTicketAuthority({
    issuer: "integration-web",
    secret: "integration-secret-at-least-16-characters",
    clock,
    lifetimeSeconds: 600,
  });
  const roomStore = new InMemoryRoomStore();
  const replayStore = new ControlledReplayStore();
  const metrics = new InMemoryMetricsCollector();
  const logs: RuntimeLogEvent[] = [];
  let app: GameServerApplication;
  let address: GameServerAddress;

  beforeAll(async () => {
    app = createGameServer({
      ticketVerifier: authority,
      roomStore,
      replayStore,
      metrics,
      clock,
      ids: createDeterministicRuntimeIdSource([
        "PLAY2345",
        "FALL2345",
        "TAKE2345",
        "LEAV2345",
        "WALT2345",
        "TTLM2345",
        "CFPLAY45",
        "CFDRAW45",
        "CFLEAV45",
        "GMPLAY45",
      ]),
      logger: { write: (event) => logs.push(event) },
    });
    address = await app.start({ port: 0 });
  });

  afterAll(async () => {
    if (app !== undefined) {
      await app.stop();
    }
  });

  it("serves health/metrics and rejects every ticket trust-boundary failure", async () => {
    const health = await fetch(`${address.httpUrl}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ok" });
    const metricsResponse = await fetch(`${address.httpUrl}/metrics`);
    expect(metricsResponse.status).toBe(200);

    const client = new ColyseusClient(address.httpUrl);
    const base = {
      type: "room.create",
      protocolVersion: PROTOCOL_VERSION,
      gameId: "tic-tac-toe",
      initialConfig: null,
    } as const;
    const failures: unknown[] = [
      base,
      { ...base, ticket: "invalid-ticket" },
      {
        ...base,
        ticket: authority.issue("auth-a", {
          issuedAt: 900,
          expiresAt: 999,
        }),
      },
      {
        ...base,
        ticket: authority.issue("auth-a", { audience: "wrong-service" }),
      },
      {
        ...base,
        ticket: authority.issue("auth-a", { protocolVersion: 2 }),
      },
      {
        ...base,
        protocolVersion: 2,
        ticket: authority.issue("auth-a"),
      },
      {
        ...base,
        ticket: authority.issue("auth-a"),
        gameId: "unknown-game",
      },
      {
        ...base,
        ticket: authority.issue("auth-a"),
        initialConfig: {},
      },
    ];
    for (const request of failures) {
      await expect(client.create(GAME_ROOM_NAME, request)).rejects.toThrow();
    }
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain("integration-secret");
    expect(serializedLogs).not.toContain("invalid-ticket");
  });

  it("runs a two-client authoritative match and produces a verified canonical replay", async () => {
    const clientA = new ColyseusClient(address.httpUrl);
    const clientB = new ColyseusClient(address.httpUrl);
    const roomA = await clientA.create(GAME_ROOM_NAME, {
      type: "room.create",
      protocolVersion: PROTOCOL_VERSION,
      ticket: authority.issue("play-a"),
      gameId: "tic-tac-toe",
      initialConfig: null,
    });
    const inboxA = new MessageInbox(roomA);
    const lifecycleA = new LifecycleInbox(roomA);
    const connectedA = await inboxA.next(
      (message) => message.type === "room.connected",
    );
    expect(connectedA).toMatchObject({
      type: "room.connected",
      roomCode: "PLAY2345",
      playerSlotId: "slot-1",
    });
    const waitingA = await inboxA.next(isSnapshot);
    expect(waitingA).toMatchObject({ revision: 0, status: "waiting" });

    const activeForA = inboxA.next(
      (message) => isSnapshot(message) && message.status === "active",
    );
    const roomB = await clientB.join(GAME_ROOM_NAME, {
      type: "room.join",
      protocolVersion: PROTOCOL_VERSION,
      ticket: authority.issue("play-b"),
      roomCode: "PLAY2345",
    });
    const inboxB = new MessageInbox(roomB);
    const lifecycleB = new LifecycleInbox(roomB);
    const connectedB = await inboxB.next(
      (message) => message.type === "room.connected",
    );
    expect(connectedB).toMatchObject({
      roomCode: "PLAY2345",
      playerSlotId: "slot-2",
    });
    const [activeA, activeB] = await Promise.all([
      activeForA,
      inboxB.next(
        (message) => isSnapshot(message) && message.status === "active",
      ),
    ]);
    expect(activeA).toMatchObject({
      viewer: { kind: "player", slotId: "slot-1" },
    });
    expect(activeB).toMatchObject({
      viewer: { kind: "player", slotId: "slot-2" },
    });
    expect(JSON.stringify(activeA)).not.toContain("test-seed");
    expect(activeA).not.toHaveProperty("state");
    expect((activeA as MatchSnapshot).view).not.toHaveProperty(
      "nextPlayerIndex",
    );

    roomA.send(GAME_ACTION_MESSAGE, {
      ...command("forged", 0, { type: "PLACE_MARK", cell: 0 }),
      actorSlotId: "slot-2",
    });
    await expect(
      inboxA.next(
        (message) =>
          message.type === "command.rejected" &&
          message.code === "INVALID_ACTION_PAYLOAD",
      ),
    ).resolves.toMatchObject({ code: "INVALID_ACTION_PAYLOAD" });
    roomA.send(
      GAME_ACTION_MESSAGE,
      command("invalid-action", 0, { type: "PLACE_MARK", cell: 9 }),
    );
    await expect(
      inboxA.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "invalid-action",
      ),
    ).resolves.toMatchObject({ code: "INVALID_ACTION_PAYLOAD", revision: 0 });

    const acceptedA1 = inboxA.next(
      (message) =>
        isSnapshot(message) && message.causedByCommandId === "play-1",
    );
    const broadcastB1 = inboxB.next(
      (message) => isSnapshot(message) && message.revision === 1,
    );
    roomA.send(
      GAME_ACTION_MESSAGE,
      command("play-1", 0, { type: "PLACE_MARK", cell: 0 }),
    );
    await Promise.all([acceptedA1, broadcastB1]);

    roomA.send(
      GAME_ACTION_MESSAGE,
      command("play-1", 0, { type: "PLACE_MARK", cell: 0 }),
    );
    await expect(
      inboxA.next(
        (message) =>
          isSnapshot(message) && message.causedByCommandId === "play-1",
      ),
    ).resolves.toMatchObject({ revision: 1 });

    roomB.send(
      GAME_ACTION_MESSAGE,
      command("stale", 0, { type: "PLACE_MARK", cell: 3 }),
    );
    await expect(
      inboxB.next(
        (message) =>
          message.type === "command.rejected" && message.commandId === "stale",
      ),
    ).resolves.toMatchObject({
      code: "STALE_REVISION",
      revision: 1,
      snapshot: { revision: 1, viewer: { slotId: "slot-2" } },
    });

    const playAccepted = async (
      room: ClientRoom,
      inbox: MessageInbox,
      id: string,
      revision: number,
      cell: number,
      roundNumber?: number,
    ): Promise<ServerMessage> => {
      const result = inbox.next(
        (message) => isSnapshot(message) && message.causedByCommandId === id,
      );
      room.send(
        GAME_ACTION_MESSAGE,
        command(id, revision, { type: "PLACE_MARK", cell }, roundNumber),
      );
      return result;
    };

    await playAccepted(roomB, inboxB, "play-2", 1, 3);
    roomB.send(
      GAME_ACTION_MESSAGE,
      command("rule-reject", 2, { type: "PLACE_MARK", cell: 4 }),
    );
    await expect(
      inboxB.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "rule-reject",
      ),
    ).resolves.toMatchObject({
      code: "GAME_RULE_REJECTED",
      gameRuleCode: "NOT_YOUR_TURN",
      revision: 2,
    });

    const concurrentA = inboxA.next(
      (message) =>
        isSnapshot(message) && message.causedByCommandId === "play-3",
    );
    const concurrentB = inboxB.next(
      (message) =>
        message.type === "command.rejected" && message.commandId === "racing-b",
    );
    roomA.send(
      GAME_ACTION_MESSAGE,
      command("play-3", 2, { type: "PLACE_MARK", cell: 1 }),
    );
    roomB.send(
      GAME_ACTION_MESSAGE,
      command("racing-b", 2, { type: "PLACE_MARK", cell: 4 }),
    );
    await Promise.all([concurrentA, concurrentB]);
    await playAccepted(roomB, inboxB, "play-4", 3, 4);
    const completed = await playAccepted(roomA, inboxA, "play-5", 4, 2);
    expect(completed).toMatchObject({
      revision: 5,
      status: "completed",
      outcome: { type: "WIN", winnerSlotId: "slot-1" },
    });

    roomA.send(
      GAME_ACTION_MESSAGE,
      command("after-complete", 5, { type: "PLACE_MARK", cell: 8 }),
    );
    await expect(
      inboxA.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "after-complete",
      ),
    ).resolves.toMatchObject({ code: "MATCH_NOT_ACTIVE", revision: 5 });

    const stored = await roomStore.getByRoomCode("PLAY2345");
    expect(stored).toMatchObject({ status: "completed", revision: 5 });
    const replay = await replayStore.get(stored?.replayId ?? "");
    expect(replay?.actions).toHaveLength(5);
    expect(replay?.actions.map((event) => event.action)).toEqual([
      { type: "PLACE_MARK", cell: 0 },
      { type: "PLACE_MARK", cell: 3 },
      { type: "PLACE_MARK", cell: 1 },
      { type: "PLACE_MARK", cell: 4 },
      { type: "PLACE_MARK", cell: 2 },
    ]);
    expect(verifyReplay(replay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: { type: "WIN", winnerSlotId: "slot-1" },
    });

    await Promise.all([
      lifecycleA.next(
        (message) => message.roundNumber === 1 && message.rematch.available,
      ),
      lifecycleB.next(
        (message) => message.roundNumber === 1 && message.rematch.available,
      ),
    ]);

    roomB.send(
      ROOM_CONTROL_MESSAGE,
      controlCommand("non-owner-close", "CLOSE_ROOM"),
    );
    await expect(
      inboxB.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "non-owner-close",
      ),
    ).resolves.toMatchObject({ code: "ROOM_CONTROL_NOT_ALLOWED" });

    const readyA1 = lifecycleA.next(
      (message) => message.causedByCommandId === "ready-a-1",
    );
    roomA.send(
      ROOM_CONTROL_MESSAGE,
      controlCommand("ready-a-1", "REQUEST_REMATCH"),
    );
    await expect(readyA1).resolves.toMatchObject({
      roundNumber: 1,
      rematch: { selfReady: true, readyPlayerCount: 1 },
    });
    const cancelledA = lifecycleA.next(
      (message) => message.causedByCommandId === "cancel-a",
    );
    roomA.send(
      ROOM_CONTROL_MESSAGE,
      controlCommand("cancel-a", "CANCEL_REMATCH"),
    );
    await expect(cancelledA).resolves.toMatchObject({
      rematch: { selfReady: false, readyPlayerCount: 0 },
    });

    const readyA2 = lifecycleA.next(
      (message) => message.causedByCommandId === "ready-a-2",
    );
    roomA.send(
      ROOM_CONTROL_MESSAGE,
      controlCommand("ready-a-2", "REQUEST_REMATCH"),
    );
    await readyA2;
    const roundTwoLifecycleA = lifecycleA.next(
      (message) => message.roundNumber === 2,
    );
    const roundTwoLifecycleB = lifecycleB.next(
      (message) =>
        message.roundNumber === 2 && message.causedByCommandId === "ready-b",
    );
    const roundTwoSnapshotA = inboxA.next(
      (message) =>
        isSnapshot(message) &&
        message.status === "active" &&
        message.revision === 0,
    );
    const roundTwoSnapshotB = inboxB.next(
      (message) =>
        isSnapshot(message) &&
        message.status === "active" &&
        message.revision === 0,
    );
    roomB.send(
      ROOM_CONTROL_MESSAGE,
      controlCommand("ready-b", "REQUEST_REMATCH"),
    );
    await Promise.all([
      roundTwoLifecycleA,
      roundTwoLifecycleB,
      roundTwoSnapshotA,
      roundTwoSnapshotB,
    ]);
    const roundTwoStored = await roomStore.getByRoomCode("PLAY2345");
    expect(roundTwoStored).toMatchObject({
      roundNumber: 2,
      revision: 0,
      status: "active",
    });
    expect(roundTwoStored?.replayId).not.toBe(stored?.replayId);

    const duplicateFromRoundOne = inboxA.next(
      (message) =>
        isSnapshot(message) && message.causedByCommandId === "play-1",
    );
    roomA.send(
      GAME_ACTION_MESSAGE,
      command("play-1", 0, { type: "PLACE_MARK", cell: 0 }),
    );
    await expect(duplicateFromRoundOne).resolves.toMatchObject({
      roundNumber: 1,
      revision: 1,
    });
    roomA.send(
      GAME_ACTION_MESSAGE,
      command("wrong-round", 0, { type: "PLACE_MARK", cell: 0 }, 1),
    );
    await expect(
      inboxA.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "wrong-round",
      ),
    ).resolves.toMatchObject({
      code: "STALE_REVISION",
      snapshot: { roundNumber: 2, revision: 0 },
    });
    expect(await roomStore.getByRoomCode("PLAY2345")).toMatchObject({
      roundNumber: 2,
      revision: 0,
    });

    await playAccepted(roomA, inboxA, "round-2-play-1", 0, 0, 2);
    await playAccepted(roomB, inboxB, "round-2-play-2", 1, 3, 2);
    await playAccepted(roomA, inboxA, "round-2-play-3", 2, 1, 2);
    await playAccepted(roomB, inboxB, "round-2-play-4", 3, 4, 2);
    await playAccepted(roomA, inboxA, "round-2-play-5", 4, 2, 2);
    const completedRoundTwo = await roomStore.getByRoomCode("PLAY2345");
    expect(completedRoundTwo).toMatchObject({
      roundNumber: 2,
      revision: 5,
      status: "completed",
    });
    const replayRoundTwo = await replayStore.get(
      completedRoundTwo?.replayId ?? "",
    );
    expect(replayRoundTwo?.actions).toHaveLength(5);
    expect(verifyReplay(replayRoundTwo, resolveGameDefinition)).toMatchObject({
      status: "verified",
      outcome: { type: "WIN", winnerSlotId: "slot-1" },
    });

    await expect(
      new ColyseusClient(address.httpUrl).join(GAME_ROOM_NAME, {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("terminal-outsider"),
        roomCode: "PLAY2345",
      }),
    ).rejects.toThrow("ROOM_NOT_JOINABLE");

    const closedA = lifecycleA.next(
      (message) => message.closeReason === "OWNER_CLOSED",
    );
    const closedB = lifecycleB.next(
      (message) => message.closeReason === "OWNER_CLOSED",
    );
    const leftA = new Promise<void>((resolve) =>
      roomA.onLeave.once(() => resolve()),
    );
    const leftB = new Promise<void>((resolve) =>
      roomB.onLeave.once(() => resolve()),
    );
    roomA.send(
      ROOM_CONTROL_MESSAGE,
      controlCommand("owner-close", "CLOSE_ROOM"),
    );
    await Promise.all([closedA, closedB, leftA, leftB]);
  });

  it("does not acknowledge or commit when replay append fails", async () => {
    const clientA = new ColyseusClient(address.httpUrl);
    const clientB = new ColyseusClient(address.httpUrl);
    const roomA = await clientA.create(GAME_ROOM_NAME, {
      type: "room.create",
      protocolVersion: PROTOCOL_VERSION,
      ticket: authority.issue("failure-a"),
      gameId: "tic-tac-toe",
      initialConfig: null,
    });
    const inboxA = new MessageInbox(roomA);
    await inboxA.next((message) => message.type === "room.connected");
    const roomB = await clientB.join(GAME_ROOM_NAME, {
      type: "room.join",
      protocolVersion: PROTOCOL_VERSION,
      ticket: authority.issue("failure-b"),
      roomCode: "FALL2345",
    });
    const inboxB = new MessageInbox(roomB);
    await inboxB.next(
      (message) => isSnapshot(message) && message.status === "active",
    );

    replayStore.failNextAppend = true;
    roomA.send(
      GAME_ACTION_MESSAGE,
      command("append-fails", 0, { type: "PLACE_MARK", cell: 0 }),
    );
    await expect(
      inboxA.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "append-fails",
      ),
    ).resolves.toMatchObject({ code: "INTERNAL_ERROR", revision: 0 });
    const stored = await roomStore.getByRoomCode("FALL2345");
    const replay = await replayStore.get(stored?.replayId ?? "");
    expect(stored).toMatchObject({ revision: 0, status: "active" });
    expect(replay?.actions).toEqual([]);
    expect(
      metrics
        .snapshot()
        .find((sample) => sample.name === "replay_append_failure_total")?.value,
    ).toBe(1);
    await roomA.leave(true);
  });

  it("restores stable slots, takes over old connections, and abandons after fake-clock timeout", async () => {
    const clientA = new ColyseusClient(address.httpUrl);
    const clientB = new ColyseusClient(address.httpUrl);
    const roomA = await clientA.create(GAME_ROOM_NAME, {
      type: "room.create",
      protocolVersion: PROTOCOL_VERSION,
      ticket: authority.issue("take-a"),
      gameId: "tic-tac-toe",
      initialConfig: null,
    });
    const inboxA = new MessageInbox(roomA);
    const connectedA = await inboxA.next(
      (message) => message.type === "room.connected",
    );
    const roomB = await clientB.join(GAME_ROOM_NAME, {
      type: "room.join",
      protocolVersion: PROTOCOL_VERSION,
      ticket: authority.issue("take-b"),
      roomCode: "TAKE2345",
    });
    const inboxB = new MessageInbox(roomB);
    await inboxB.next(
      (message) => isSnapshot(message) && message.status === "active",
    );

    const oldConnectionLeft = new Promise<void>((resolve) => {
      roomA.onLeave.once(() => resolve());
    });
    const takeoverClient = new ColyseusClient(address.httpUrl);
    const takeoverRoom = await takeoverClient.join(GAME_ROOM_NAME, {
      type: "room.join",
      protocolVersion: PROTOCOL_VERSION,
      ticket: authority.issue("take-a"),
      roomCode: "TAKE2345",
    });
    const takeoverInbox = new MessageInbox(takeoverRoom);
    const takeoverConnected = await takeoverInbox.next(
      (message) => message.type === "room.connected",
    );
    expect(takeoverConnected).toMatchObject({
      playerSlotId: (connectedA as { playerSlotId: string }).playerSlotId,
    });
    await oldConnectionLeft;
    roomA.send(
      GAME_ACTION_MESSAGE,
      command("replaced-connection", 0, { type: "PLACE_MARK", cell: 0 }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(await roomStore.getByRoomCode("TAKE2345")).toMatchObject({
      revision: 0,
    });

    await takeoverRoom.leave(false);
    await waitUntil(async () => {
      const stored = await roomStore.getByRoomCode("TAKE2345");
      return stored?.players[0]?.reservedUntilMilliseconds !== null;
    });
    const thief = new ColyseusClient(address.httpUrl);
    await expect(
      thief.join(GAME_ROOM_NAME, {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("take-thief"),
        roomCode: "TAKE2345",
      }),
    ).rejects.toThrow();

    const reconnectClient = new ColyseusClient(address.httpUrl);
    const reconnectedRoom = await reconnectClient.join(GAME_ROOM_NAME, {
      type: "room.join",
      protocolVersion: PROTOCOL_VERSION,
      ticket: authority.issue("take-a"),
      roomCode: "TAKE2345",
    });
    const reconnectInbox = new MessageInbox(reconnectedRoom);
    const reconnected = await reconnectInbox.next(
      (message) => message.type === "room.connected",
    );
    expect(reconnected).toMatchObject({ playerSlotId: "slot-1" });
    await reconnectInbox.next(isSnapshot);
    const reconnectionToken = reconnectedRoom.reconnectionToken;
    await reconnectedRoom.leave(false);
    await waitUntil(async () => {
      const stored = await roomStore.getByRoomCode("TAKE2345");
      return stored?.players[0]?.reservedUntilMilliseconds !== null;
    });

    clock.advanceBy(60_000);
    await waitUntil(
      async () =>
        (await roomStore.getByRoomCode("TAKE2345"))?.status === "abandoned",
    );
    await expect(
      new ColyseusClient(address.httpUrl).reconnect(reconnectionToken),
    ).rejects.toThrow();
    await expect(
      new ColyseusClient(address.httpUrl).join(GAME_ROOM_NAME, {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("take-a"),
        roomCode: "TAKE2345",
      }),
    ).rejects.toThrow();
    expect(await roomStore.getByRoomCode("TAKE2345")).toMatchObject({
      status: "abandoned",
      revision: 0,
    });
  });

  it("closes immediately on explicit active leave and lets the owner close a waiting room", async () => {
    const roomA = await new ColyseusClient(address.httpUrl).create(
      GAME_ROOM_NAME,
      {
        type: "room.create",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("leave-a"),
        gameId: "tic-tac-toe",
        initialConfig: null,
      },
    );
    const inboxA = new MessageInbox(roomA);
    const lifecycleA = new LifecycleInbox(roomA);
    await inboxA.next((message) => message.type === "room.connected");
    const activeA = inboxA.next(
      (message) => isSnapshot(message) && message.status === "active",
    );
    const roomB = await new ColyseusClient(address.httpUrl).join(
      GAME_ROOM_NAME,
      {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("leave-b"),
        roomCode: "LEAV2345",
      },
    );
    await activeA;
    const abandonedA = inboxA.next(
      (message) => isSnapshot(message) && message.status === "abandoned",
    );
    const closedA = lifecycleA.next(
      (message) => message.closeReason === "PLAYER_LEFT",
    );
    const leftA = new Promise<void>((resolve) =>
      roomA.onLeave.once(() => resolve()),
    );
    await roomB.leave(true);
    await Promise.all([abandonedA, closedA, leftA]);
    expect(await roomStore.getByRoomCode("LEAV2345")).toMatchObject({
      roundNumber: 1,
      revision: 0,
      status: "abandoned",
    });

    const waitingRoom = await new ColyseusClient(address.httpUrl).create(
      GAME_ROOM_NAME,
      {
        type: "room.create",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("waiting-owner"),
        gameId: "tic-tac-toe",
        initialConfig: null,
      },
    );
    const waitingInbox = new MessageInbox(waitingRoom);
    const waitingLifecycle = new LifecycleInbox(waitingRoom);
    await waitingInbox.next(
      (message) => isSnapshot(message) && message.status === "waiting",
    );
    const ownerClosed = waitingLifecycle.next(
      (message) => message.closeReason === "OWNER_CLOSED",
    );
    waitingRoom.send(
      ROOM_CONTROL_MESSAGE,
      controlCommand("close-waiting", "CLOSE_ROOM"),
    );
    await ownerClosed;
    expect(await roomStore.getByRoomCode("WALT2345")).toMatchObject({
      status: "abandoned",
    });
  });

  it("clears rematch ready on disconnect/takeover and expires terminal rooms", async () => {
    const roomA = await new ColyseusClient(address.httpUrl).create(
      GAME_ROOM_NAME,
      {
        type: "room.create",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("ttl-a"),
        gameId: "tic-tac-toe",
        initialConfig: null,
      },
    );
    const inboxA = new MessageInbox(roomA);
    const lifecycleA = new LifecycleInbox(roomA);
    await inboxA.next((message) => message.type === "room.connected");
    const roomB = await new ColyseusClient(address.httpUrl).join(
      GAME_ROOM_NAME,
      {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("ttl-b"),
        roomCode: "TTLM2345",
      },
    );
    const inboxB = new MessageInbox(roomB);
    const lifecycleB = new LifecycleInbox(roomB);
    await inboxB.next(
      (message) => isSnapshot(message) && message.status === "active",
    );

    const accept = async (
      room: ClientRoom,
      inbox: MessageInbox,
      id: string,
      revision: number,
      cell: number,
    ): Promise<void> => {
      const accepted = inbox.next(
        (message) => isSnapshot(message) && message.causedByCommandId === id,
      );
      room.send(
        GAME_ACTION_MESSAGE,
        command(id, revision, { type: "PLACE_MARK", cell }),
      );
      await accepted;
    };
    await accept(roomA, inboxA, "ttl-1", 0, 0);
    await accept(roomB, inboxB, "ttl-2", 1, 3);
    await accept(roomA, inboxA, "ttl-3", 2, 1);
    await accept(roomB, inboxB, "ttl-4", 3, 4);
    await accept(roomA, inboxA, "ttl-5", 4, 2);
    await Promise.all([
      lifecycleA.next((message) => message.rematch.available),
      lifecycleB.next((message) => message.rematch.available),
    ]);

    const readyA = lifecycleA.next(
      (message) => message.causedByCommandId === "ttl-ready-a",
    );
    roomA.send(
      ROOM_CONTROL_MESSAGE,
      controlCommand("ttl-ready-a", "REQUEST_REMATCH"),
    );
    await readyA;
    const clearedAfterDisconnect = lifecycleB.next(
      (message) =>
        message.rematch.available && message.rematch.readyPlayerCount === 0,
    );
    await roomA.leave(false);
    await clearedAfterDisconnect;

    const reconnectedA = await new ColyseusClient(address.httpUrl).join(
      GAME_ROOM_NAME,
      {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("ttl-a"),
        roomCode: "TTLM2345",
      },
    );
    const reconnectInbox = new MessageInbox(reconnectedA);
    const reconnectLifecycle = new LifecycleInbox(reconnectedA);
    await reconnectInbox.next((message) => message.type === "room.connected");
    await lifecycleB.next(
      (message) =>
        message.rematch.available && message.rematch.readyPlayerCount === 0,
    );

    const readyReconnect = reconnectLifecycle.next(
      (message) => message.causedByCommandId === "ttl-ready-reconnect",
    );
    const readyForB = lifecycleB.next(
      (message) => message.rematch.readyPlayerCount === 1,
    );
    reconnectedA.send(
      ROOM_CONTROL_MESSAGE,
      controlCommand("ttl-ready-reconnect", "REQUEST_REMATCH"),
    );
    await Promise.all([readyReconnect, readyForB]);
    const clearedAfterTakeover = lifecycleB.next(
      (message) => message.rematch.readyPlayerCount === 0,
    );
    const takeoverA = await new ColyseusClient(address.httpUrl).join(
      GAME_ROOM_NAME,
      {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("ttl-a"),
        roomCode: "TTLM2345",
      },
    );
    const takeoverLifecycle = new LifecycleInbox(takeoverA);
    await clearedAfterTakeover;

    const ttlClosedA = takeoverLifecycle.next(
      (message) => message.closeReason === "REMATCH_TIMEOUT",
    );
    const ttlClosedB = lifecycleB.next(
      (message) => message.closeReason === "REMATCH_TIMEOUT",
    );
    clock.advanceBy(300_000);
    await Promise.all([ttlClosedA, ttlClosedB]);
    expect(await roomStore.getByRoomCode("TTLM2345")).toMatchObject({
      status: "completed",
      roundNumber: 1,
      revision: 5,
    });
  });

  it("runs Connect Four authoritatively across rules, reconnection, rematch, terminal lifecycle, draw, and abandonment", async () => {
    const originalRoomA = await new ColyseusClient(address.httpUrl).create(
      GAME_ROOM_NAME,
      {
        type: "room.create",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("connect-four-a"),
        gameId: "connect-four",
        initialConfig: null,
      },
    );
    const originalInboxA = new MessageInbox(originalRoomA);
    const connectedA = await originalInboxA.next(
      (message) => message.type === "room.connected",
    );
    expect(connectedA).toMatchObject({
      gameId: "connect-four",
      gameVersion: "1.0.0",
      roomCode: "CFPLAY45",
      playerSlotId: "slot-1",
    });
    await expect(originalInboxA.next(isSnapshot)).resolves.toMatchObject({
      roundNumber: 1,
      revision: 0,
      status: "waiting",
    });

    const activeForA = originalInboxA.next(
      (message) => isSnapshot(message) && message.status === "active",
    );
    const originalRoomB = await new ColyseusClient(address.httpUrl).join(
      GAME_ROOM_NAME,
      {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("connect-four-b"),
        roomCode: "CFPLAY45",
      },
    );
    const originalInboxB = new MessageInbox(originalRoomB);
    const connectedB = await originalInboxB.next(
      (message) => message.type === "room.connected",
    );
    const [initialA, initialB] = await Promise.all([
      activeForA,
      originalInboxB.next(
        (message) => isSnapshot(message) && message.status === "active",
      ),
    ]);
    expect(connectedB).toMatchObject({
      roomCode: "CFPLAY45",
      playerSlotId: "slot-2",
    });
    expect(initialA).toMatchObject({
      viewer: { kind: "player", slotId: "slot-1" },
      view: { yourDisc: "RED", nextTurnSlotId: "slot-1" },
    });
    expect(initialB).toMatchObject({
      viewer: { kind: "player", slotId: "slot-2" },
      view: { yourDisc: "YELLOW", nextTurnSlotId: "slot-1" },
    });
    expect(initialA).not.toHaveProperty("state");
    expect((initialA as MatchSnapshot).view).not.toHaveProperty(
      "nextPlayerIndex",
    );

    const oldConnectionLeft = new Promise<void>((resolve) =>
      originalRoomA.onLeave.once(() => resolve()),
    );
    const roomA = await new ColyseusClient(address.httpUrl).join(
      GAME_ROOM_NAME,
      {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("connect-four-a"),
        roomCode: "CFPLAY45",
      },
    );
    const inboxA = new MessageInbox(roomA);
    const lifecycleA = new LifecycleInbox(roomA);
    await expect(
      inboxA.next((message) => message.type === "room.connected"),
    ).resolves.toMatchObject({
      roomCode: "CFPLAY45",
      playerSlotId: "slot-1",
    });
    await inboxA.next(
      (message) => isSnapshot(message) && message.status === "active",
    );
    await oldConnectionLeft;

    await originalRoomB.leave(false);
    await waitUntil(async () => {
      const stored = await roomStore.getByRoomCode("CFPLAY45");
      return stored?.players[1]?.reservedUntilMilliseconds !== null;
    });
    const roomB = await new ColyseusClient(address.httpUrl).join(
      GAME_ROOM_NAME,
      {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("connect-four-b"),
        roomCode: "CFPLAY45",
      },
    );
    const inboxB = new MessageInbox(roomB);
    const lifecycleB = new LifecycleInbox(roomB);
    await expect(
      inboxB.next((message) => message.type === "room.connected"),
    ).resolves.toMatchObject({
      roomCode: "CFPLAY45",
      playerSlotId: "slot-2",
    });
    await inboxB.next(
      (message) => isSnapshot(message) && message.status === "active",
    );

    roomA.send(GAME_ACTION_MESSAGE, {
      ...command("cf-forged", 0, { type: "DROP_DISC", column: 0 }),
      actorSlotId: "slot-2",
    });
    await expect(
      inboxA.next(
        (message) =>
          message.type === "command.rejected" &&
          message.code === "INVALID_ACTION_PAYLOAD",
      ),
    ).resolves.toMatchObject({
      code: "INVALID_ACTION_PAYLOAD",
      revision: 0,
    });
    roomA.send(
      GAME_ACTION_MESSAGE,
      command("cf-out-of-bounds", 0, { type: "DROP_DISC", column: 7 }),
    );
    await expect(
      inboxA.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "cf-out-of-bounds",
      ),
    ).resolves.toMatchObject({
      code: "INVALID_ACTION_PAYLOAD",
      revision: 0,
    });
    roomB.send(
      GAME_ACTION_MESSAGE,
      command("cf-wrong-turn", 0, { type: "DROP_DISC", column: 0 }),
    );
    await expect(
      inboxB.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "cf-wrong-turn",
      ),
    ).resolves.toMatchObject({
      code: "GAME_RULE_REJECTED",
      gameRuleCode: "NOT_YOUR_TURN",
      revision: 0,
    });

    const acceptDrop = async (
      room: ClientRoom,
      inbox: MessageInbox,
      id: string,
      revision: number,
      column: number,
      roundNumber = 1,
    ): Promise<MatchSnapshot> => {
      const accepted = inbox.next(
        (message) => isSnapshot(message) && message.causedByCommandId === id,
      );
      room.send(
        GAME_ACTION_MESSAGE,
        command(id, revision, { type: "DROP_DISC", column }, roundNumber),
      );
      return (await accepted) as MatchSnapshot;
    };

    await acceptDrop(roomA, inboxA, "cf-fill-1", 0, 0);
    roomA.send(
      GAME_ACTION_MESSAGE,
      command("cf-fill-1", 0, { type: "DROP_DISC", column: 0 }),
    );
    await expect(
      inboxA.next(
        (message) =>
          isSnapshot(message) && message.causedByCommandId === "cf-fill-1",
      ),
    ).resolves.toMatchObject({ roundNumber: 1, revision: 1 });
    roomB.send(
      GAME_ACTION_MESSAGE,
      command("cf-stale", 0, { type: "DROP_DISC", column: 0 }),
    );
    await expect(
      inboxB.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "cf-stale",
      ),
    ).resolves.toMatchObject({
      code: "STALE_REVISION",
      revision: 1,
      snapshot: { roundNumber: 1, revision: 1 },
    });

    await acceptDrop(roomB, inboxB, "cf-fill-2", 1, 0);
    await acceptDrop(roomA, inboxA, "cf-fill-3", 2, 0);
    await acceptDrop(roomB, inboxB, "cf-fill-4", 3, 0);
    await acceptDrop(roomA, inboxA, "cf-fill-5", 4, 0);
    await acceptDrop(roomB, inboxB, "cf-fill-6", 5, 0);
    roomA.send(
      GAME_ACTION_MESSAGE,
      command("cf-column-full", 6, { type: "DROP_DISC", column: 0 }),
    );
    await expect(
      inboxA.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "cf-column-full",
      ),
    ).resolves.toMatchObject({
      code: "GAME_RULE_REJECTED",
      gameRuleCode: "COLUMN_FULL",
      revision: 6,
    });
    expect(await roomStore.getByRoomCode("CFPLAY45")).toMatchObject({
      revision: 6,
      status: "active",
    });

    await acceptDrop(roomA, inboxA, "cf-win-1", 6, 1);
    await acceptDrop(roomB, inboxB, "cf-win-2", 7, 6);
    await acceptDrop(roomA, inboxA, "cf-win-3", 8, 2);
    await acceptDrop(roomB, inboxB, "cf-win-4", 9, 6);
    const completedRoundOne = await acceptDrop(
      roomA,
      inboxA,
      "cf-win-5",
      10,
      3,
    );
    expect(completedRoundOne).toMatchObject({
      roundNumber: 1,
      revision: 11,
      status: "completed",
      outcome: {
        type: "WIN",
        winnerSlotId: "slot-1",
        winningCells: [35, 36, 37, 38],
      },
    });
    roomA.send(
      GAME_ACTION_MESSAGE,
      command("cf-after-terminal", 11, { type: "DROP_DISC", column: 4 }),
    );
    await expect(
      inboxA.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "cf-after-terminal",
      ),
    ).resolves.toMatchObject({
      code: "MATCH_NOT_ACTIVE",
      revision: 11,
    });

    const storedRoundOne = await roomStore.getByRoomCode("CFPLAY45");
    const replayRoundOne = await replayStore.get(
      storedRoundOne?.replayId ?? "",
    );
    expect(storedRoundOne).toMatchObject({
      gameId: "connect-four",
      gameVersion: "1.0.0",
      roundNumber: 1,
      revision: 11,
      status: "completed",
    });
    expect(replayRoundOne?.actions).toHaveLength(11);
    expect(replayRoundOne?.actions.map((event) => event.action)).toEqual([
      { type: "DROP_DISC", column: 0 },
      { type: "DROP_DISC", column: 0 },
      { type: "DROP_DISC", column: 0 },
      { type: "DROP_DISC", column: 0 },
      { type: "DROP_DISC", column: 0 },
      { type: "DROP_DISC", column: 0 },
      { type: "DROP_DISC", column: 1 },
      { type: "DROP_DISC", column: 6 },
      { type: "DROP_DISC", column: 2 },
      { type: "DROP_DISC", column: 6 },
      { type: "DROP_DISC", column: 3 },
    ]);
    expect(replayRoundOne).toMatchObject({
      recordedRngCursor: 0,
      recordedOutcome: { type: "WIN", winnerSlotId: "slot-1" },
    });
    expect(verifyReplay(replayRoundOne, resolveGameDefinition)).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: { type: "WIN", winnerSlotId: "slot-1" },
    });

    await Promise.all([
      lifecycleA.next((message) => message.rematch.available),
      lifecycleB.next((message) => message.rematch.available),
    ]);
    const readyA = lifecycleA.next(
      (message) => message.causedByCommandId === "cf-ready-a",
    );
    roomA.send(
      ROOM_CONTROL_MESSAGE,
      controlCommand("cf-ready-a", "REQUEST_REMATCH"),
    );
    await readyA;
    const roundTwoLifecycleA = lifecycleA.next(
      (message) => message.roundNumber === 2,
    );
    const roundTwoLifecycleB = lifecycleB.next(
      (message) =>
        message.roundNumber === 2 && message.causedByCommandId === "cf-ready-b",
    );
    const roundTwoSnapshotA = inboxA.next(
      (message) =>
        isSnapshot(message) &&
        message.roundNumber === 2 &&
        message.revision === 0,
    );
    const roundTwoSnapshotB = inboxB.next(
      (message) =>
        isSnapshot(message) &&
        message.roundNumber === 2 &&
        message.revision === 0,
    );
    roomB.send(
      ROOM_CONTROL_MESSAGE,
      controlCommand("cf-ready-b", "REQUEST_REMATCH"),
    );
    await Promise.all([
      roundTwoLifecycleA,
      roundTwoLifecycleB,
      roundTwoSnapshotA,
      roundTwoSnapshotB,
    ]);
    const storedRoundTwoStart = await roomStore.getByRoomCode("CFPLAY45");
    expect(storedRoundTwoStart).toMatchObject({
      roomCode: "CFPLAY45",
      gameId: "connect-four",
      gameVersion: "1.0.0",
      roundNumber: 2,
      revision: 0,
      status: "active",
      players: [{ slotId: "slot-1" }, { slotId: "slot-2" }],
    });
    expect(storedRoundTwoStart?.replayId).not.toBe(storedRoundOne?.replayId);

    roomA.send(
      GAME_ACTION_MESSAGE,
      command("cf-wrong-round", 0, { type: "DROP_DISC", column: 0 }, 1),
    );
    await expect(
      inboxA.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "cf-wrong-round",
      ),
    ).resolves.toMatchObject({
      code: "STALE_REVISION",
      snapshot: { roundNumber: 2, revision: 0 },
    });
    await acceptDrop(roomA, inboxA, "cf-r2-1", 0, 0, 2);
    await acceptDrop(roomB, inboxB, "cf-r2-2", 1, 0, 2);
    await acceptDrop(roomA, inboxA, "cf-r2-3", 2, 1, 2);
    await acceptDrop(roomB, inboxB, "cf-r2-4", 3, 1, 2);
    await acceptDrop(roomA, inboxA, "cf-r2-5", 4, 2, 2);
    await acceptDrop(roomB, inboxB, "cf-r2-6", 5, 2, 2);
    await acceptDrop(roomA, inboxA, "cf-r2-7", 6, 3, 2);
    const storedRoundTwo = await roomStore.getByRoomCode("CFPLAY45");
    const replayRoundTwo = await replayStore.get(
      storedRoundTwo?.replayId ?? "",
    );
    expect(storedRoundTwo).toMatchObject({
      roomCode: "CFPLAY45",
      roundNumber: 2,
      revision: 7,
      status: "completed",
    });
    expect(replayRoundTwo?.actions).toHaveLength(7);
    expect(verifyReplay(replayRoundTwo, resolveGameDefinition)).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: { type: "WIN", winnerSlotId: "slot-1" },
    });

    await expect(
      new ColyseusClient(address.httpUrl).join(GAME_ROOM_NAME, {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("connect-four-outsider"),
        roomCode: "CFPLAY45",
      }),
    ).rejects.toThrow("ROOM_NOT_JOINABLE");
    const ttlClosedA = lifecycleA.next(
      (message) => message.closeReason === "REMATCH_TIMEOUT",
    );
    const ttlClosedB = lifecycleB.next(
      (message) => message.closeReason === "REMATCH_TIMEOUT",
    );
    clock.advanceBy(300_000);
    await Promise.all([ttlClosedA, ttlClosedB]);
    expect(await roomStore.getByRoomCode("CFPLAY45")).toMatchObject({
      roundNumber: 2,
      revision: 7,
      status: "completed",
    });

    const drawRoomA = await new ColyseusClient(address.httpUrl).create(
      GAME_ROOM_NAME,
      {
        type: "room.create",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("connect-four-draw-a"),
        gameId: "connect-four",
        initialConfig: null,
      },
    );
    const drawInboxA = new MessageInbox(drawRoomA);
    const drawLifecycleA = new LifecycleInbox(drawRoomA);
    await drawInboxA.next((message) => message.type === "room.connected");
    const drawActiveA = drawInboxA.next(
      (message) => isSnapshot(message) && message.status === "active",
    );
    const drawRoomB = await new ColyseusClient(address.httpUrl).join(
      GAME_ROOM_NAME,
      {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("connect-four-draw-b"),
        roomCode: "CFDRAW45",
      },
    );
    const drawInboxB = new MessageInbox(drawRoomB);
    const drawLifecycleB = new LifecycleInbox(drawRoomB);
    await Promise.all([
      drawActiveA,
      drawInboxB.next(
        (message) => isSnapshot(message) && message.status === "active",
      ),
    ]);
    const drawColumns = [
      3, 3, 5, 5, 1, 2, 6, 6, 0, 4, 4, 6, 6, 0, 4, 5, 4, 0, 2, 3, 1, 3, 0, 0, 2,
      1, 6, 2, 6, 1, 5, 0, 2, 5, 2, 4, 3, 4, 5, 3, 1, 1,
    ] as const;
    let drawSnapshot: MatchSnapshot | null = null;
    for (const [index, column] of drawColumns.entries()) {
      drawSnapshot = await acceptDrop(
        index % 2 === 0 ? drawRoomA : drawRoomB,
        index % 2 === 0 ? drawInboxA : drawInboxB,
        `cf-draw-${index + 1}`,
        index,
        column,
      );
    }
    expect(drawSnapshot).toMatchObject({
      revision: 42,
      status: "completed",
      outcome: { type: "DRAW" },
    });
    const drawStored = await roomStore.getByRoomCode("CFDRAW45");
    const drawReplay = await replayStore.get(drawStored?.replayId ?? "");
    expect(drawReplay?.actions).toHaveLength(42);
    expect(verifyReplay(drawReplay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: { type: "DRAW" },
    });
    const ownerClosedA = drawLifecycleA.next(
      (message) => message.closeReason === "OWNER_CLOSED",
    );
    const ownerClosedB = drawLifecycleB.next(
      (message) => message.closeReason === "OWNER_CLOSED",
    );
    drawRoomA.send(
      ROOM_CONTROL_MESSAGE,
      controlCommand("cf-owner-close", "CLOSE_ROOM"),
    );
    await Promise.all([ownerClosedA, ownerClosedB]);

    const leaveRoomA = await new ColyseusClient(address.httpUrl).create(
      GAME_ROOM_NAME,
      {
        type: "room.create",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("connect-four-leave-a"),
        gameId: "connect-four",
        initialConfig: null,
      },
    );
    const leaveInboxA = new MessageInbox(leaveRoomA);
    const leaveLifecycleA = new LifecycleInbox(leaveRoomA);
    await leaveInboxA.next((message) => message.type === "room.connected");
    const leaveActiveA = leaveInboxA.next(
      (message) => isSnapshot(message) && message.status === "active",
    );
    const leaveRoomB = await new ColyseusClient(address.httpUrl).join(
      GAME_ROOM_NAME,
      {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("connect-four-leave-b"),
        roomCode: "CFLEAV45",
      },
    );
    await leaveActiveA;
    await leaveRoomB.leave(true);
    await Promise.all([
      leaveInboxA.next(
        (message) => isSnapshot(message) && message.status === "abandoned",
      ),
      leaveLifecycleA.next((message) => message.closeReason === "PLAYER_LEFT"),
    ]);
    const abandonedStored = await roomStore.getByRoomCode("CFLEAV45");
    const abandonedReplay = await replayStore.get(
      abandonedStored?.replayId ?? "",
    );
    expect(abandonedStored).toMatchObject({
      gameId: "connect-four",
      gameVersion: "1.0.0",
      roundNumber: 1,
      revision: 0,
      status: "abandoned",
    });
    expect(abandonedReplay).toMatchObject({
      actions: [],
      recordedRngCursor: null,
      recordedOutcome: null,
    });
  });

  it("creates, joins, synchronizes, and completes configured Gomoku authoritatively", async () => {
    const roomA = await new ColyseusClient(address.httpUrl).create(
      GAME_ROOM_NAME,
      {
        type: "room.create",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("gomoku-a"),
        gameId: "gomoku",
        initialConfig: { boardSize: 19, winLength: 5 },
      },
    );
    const inboxA = new MessageInbox(roomA);
    await expect(
      inboxA.next((message) => message.type === "room.connected"),
    ).resolves.toMatchObject({
      gameId: "gomoku",
      gameVersion: "1.0.0",
      roomCode: "GMPLAY45",
      playerSlotId: "slot-1",
    });
    await expect(inboxA.next(isSnapshot)).resolves.toMatchObject({
      revision: 0,
      status: "waiting",
      view: {
        boardSize: 19,
        winLength: 5,
        yourStone: "BLACK",
      },
    });

    const activeA = inboxA.next(
      (message) => isSnapshot(message) && message.status === "active",
    );
    const roomB = await new ColyseusClient(address.httpUrl).join(
      GAME_ROOM_NAME,
      {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("gomoku-b"),
        roomCode: "GMPLAY45",
      },
    );
    const inboxB = new MessageInbox(roomB);
    await expect(
      inboxB.next((message) => message.type === "room.connected"),
    ).resolves.toMatchObject({
      gameId: "gomoku",
      gameVersion: "1.0.0",
      roomCode: "GMPLAY45",
      playerSlotId: "slot-2",
    });
    const [initialA, initialB] = await Promise.all([
      activeA,
      inboxB.next(
        (message) => isSnapshot(message) && message.status === "active",
      ),
    ]);
    expect(initialA).toMatchObject({
      viewer: { kind: "player", slotId: "slot-1" },
      view: {
        boardSize: 19,
        yourStone: "BLACK",
        nextTurnSlotId: "slot-1",
      },
    });
    expect(initialB).toMatchObject({
      viewer: { kind: "player", slotId: "slot-2" },
      view: {
        boardSize: 19,
        yourStone: "WHITE",
        nextTurnSlotId: "slot-1",
      },
    });
    expect((initialA as MatchSnapshot).view).not.toHaveProperty(
      "nextPlayerIndex",
    );
    expect((initialA as MatchSnapshot).view).not.toHaveProperty("config");
    expect((initialA as MatchSnapshot).view).not.toHaveProperty("rng");
    expect(
      ((initialA as MatchSnapshot).view as { board: unknown[] }).board,
    ).toHaveLength(361);

    roomB.send(
      GAME_ACTION_MESSAGE,
      command("gomoku-wrong-turn", 0, { type: "PLACE_STONE", cell: 171 }),
    );
    await expect(
      inboxB.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "gomoku-wrong-turn",
      ),
    ).resolves.toMatchObject({
      code: "GAME_RULE_REJECTED",
      gameRuleCode: "NOT_YOUR_TURN",
      revision: 0,
    });

    const acceptStone = async (
      room: ClientRoom,
      inbox: MessageInbox,
      id: string,
      revision: number,
      cell: number,
    ): Promise<MatchSnapshot> => {
      const accepted = inbox.next(
        (message) => isSnapshot(message) && message.causedByCommandId === id,
      );
      room.send(
        GAME_ACTION_MESSAGE,
        command(id, revision, { type: "PLACE_STONE", cell }, 1),
      );
      return (await accepted) as MatchSnapshot;
    };

    await acceptStone(roomA, inboxA, "gomoku-1", 0, 171);
    roomB.send(
      GAME_ACTION_MESSAGE,
      command("gomoku-occupied", 1, { type: "PLACE_STONE", cell: 171 }, 1),
    );
    await expect(
      inboxB.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "gomoku-occupied",
      ),
    ).resolves.toMatchObject({
      code: "GAME_RULE_REJECTED",
      gameRuleCode: "CELL_OCCUPIED",
      revision: 1,
    });

    const winningCells = [171, 0, 172, 1, 173, 2, 174, 3, 175] as const;
    let completed: MatchSnapshot | null = null;
    for (let index = 1; index < winningCells.length; index += 1) {
      const cell = winningCells[index];
      if (cell === undefined) throw new Error("Gomoku winning cell missing.");
      completed = await acceptStone(
        index % 2 === 0 ? roomA : roomB,
        index % 2 === 0 ? inboxA : inboxB,
        `gomoku-${index + 1}`,
        index,
        cell,
      );
    }
    expect(completed).toMatchObject({
      revision: 9,
      status: "completed",
      outcome: {
        type: "WIN",
        winnerSlotId: "slot-1",
        winningCells: [171, 172, 173, 174, 175],
      },
    });

    const stored = await roomStore.getByRoomCode("GMPLAY45");
    const replay = await replayStore.get(stored?.replayId ?? "");
    expect(stored).toMatchObject({
      gameId: "gomoku",
      gameVersion: "1.0.0",
      initialConfig: { boardSize: 19, winLength: 5 },
      revision: 9,
      status: "completed",
    });
    expect(replay?.actions).toHaveLength(9);
    expect(replay?.header.initialConfig).toEqual({
      boardSize: 19,
      winLength: 5,
    });
    expect(verifyReplay(replay, resolveGameDefinition)).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: { type: "WIN", winnerSlotId: "slot-1" },
    });
  });
});
