import { Client as ColyseusClient } from "@colyseus/sdk";
import type { Room as ClientRoom } from "@colyseus/sdk";
import {
  GAME_ACTION_MESSAGE,
  GAME_ROOM_NAME,
  InMemoryMetricsCollector,
  InMemoryReplayStore,
  InMemoryRoomStore,
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
  serverMessageSchema,
} from "@online-game-hub/protocol";
import type {
  GameActionCommand,
  MatchSnapshot,
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

function isSnapshot(message: ServerMessage): message is MatchSnapshot {
  return message.type === "match.snapshot";
}

function command(
  commandId: string,
  expectedRevision: number,
  action: unknown,
): GameActionCommand {
  return {
    type: "game.action",
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    expectedRevision,
    action,
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
    ): Promise<ServerMessage> => {
      const result = inbox.next(
        (message) => isSnapshot(message) && message.causedByCommandId === id,
      );
      room.send(
        GAME_ACTION_MESSAGE,
        command(id, revision, { type: "PLACE_MARK", cell }),
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
    await Promise.all([roomA.leave(), roomB.leave()]);
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
    await Promise.all([roomA.leave(), roomB.leave()]);
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

    await takeoverRoom.leave();
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
    await reconnectedRoom.leave();

    const abandonedForB = inboxB.next(
      (message) => isSnapshot(message) && message.status === "abandoned",
    );
    clock.advanceBy(60_000);
    await abandonedForB;
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
    await roomB.leave();
  });
});
