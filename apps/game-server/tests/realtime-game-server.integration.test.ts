import { Client as ColyseusClient } from "@colyseus/sdk";
import type { Room as ClientRoom } from "@colyseus/sdk";
import {
  REALTIME_GAME_ROOM_NAME,
  GAME_SETUP_MESSAGE,
  REALTIME_INPUT_MESSAGE,
  REALTIME_SERVER_MESSAGE,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  PROTOCOL_VERSION,
  SETUP_PROTOCOL_VERSION,
  REALTIME_PROTOCOL_VERSION,
  realtimeRejectedSchema,
  realtimeSnapshotSchema,
  roomLifecycleStateSchema,
  roomConnectedSchema,
  commandRejectedV6Schema,
  roomConnectedV6Schema,
  roomLifecycleStateV6Schema,
} from "@online-game-hub/protocol";
import type {
  CommandRejectedV6,
  RealtimeRejected,
  RealtimeSnapshot,
  RoomLifecycleState,
  RoomConnected,
  RoomConnectedV6,
  RoomLifecycleStateV6,
} from "@online-game-hub/protocol";
import {
  InMemoryRealtimeReplayStore,
  InMemoryRealtimeRoomStore,
} from "@online-game-hub/realtime-game-server-runtime";
import type {
  RealtimeMatchArchive,
  RealtimeRuntimeClock,
  RealtimeRuntimeIdSource,
  RealtimeSchedulerTimer,
  RealtimeStoredRoom,
} from "@online-game-hub/realtime-game-server-runtime";
import { verifyRealtimeReplay } from "@online-game-hub/realtime-game-sdk";
import { resolveRealtimeGameDefinition } from "@online-game-hub/game-registry/server";
import {
  FakeRuntimeClock,
  TestTicketAuthority,
} from "@online-game-hub/game-server-runtime/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGameServer } from "../src/index.js";
import type { GameServerAddress, GameServerApplication } from "../src/index.js";

class ManualSchedulerTimer implements RealtimeSchedulerTimer {
  #nextId = 1;
  readonly #callbacks = new Map<number, () => void>();

  public setInterval(callback: () => void, milliseconds: number): number {
    expect(milliseconds).toBeCloseTo(1000 / 60);
    const id = this.#nextId++;
    this.#callbacks.set(id, callback);
    return id;
  }

  public clearInterval(handle: unknown): void {
    if (typeof handle === "number") this.#callbacks.delete(handle);
  }

  public async tick(): Promise<void> {
    for (const callback of [...this.#callbacks.values()]) callback();
    // The scheduler and room writer both use promise queues.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
}

class RecordingRealtimeArchive implements RealtimeMatchArchive {
  readonly created: RealtimeStoredRoom[] = [];
  readonly saved: RealtimeStoredRoom[] = [];

  public async createRound(room: RealtimeStoredRoom): Promise<void> {
    this.created.push(structuredClone(room));
  }

  public async saveRound(room: RealtimeStoredRoom): Promise<void> {
    this.saved.push(structuredClone(room));
  }
}

interface RoomMessages {
  readonly connected: RoomConnected[];
  readonly lifecycle: RoomLifecycleState[];
  readonly snapshots: RealtimeSnapshot[];
  readonly rejections: RealtimeRejected[];
}

interface RoomMessagesV6 {
  readonly connected: RoomConnectedV6[];
  readonly lifecycle: RoomLifecycleStateV6[];
  readonly snapshots: RealtimeSnapshot[];
  readonly rejections: CommandRejectedV6[];
  readonly realtimeRejections: RealtimeRejected[];
}

function messagesV6(room: ClientRoom): RoomMessagesV6 {
  const value: RoomMessagesV6 = {
    connected: [],
    lifecycle: [],
    snapshots: [],
    rejections: [],
    realtimeRejections: [],
  };
  room.onMessage<unknown>(SERVER_PROTOCOL_MESSAGE, (raw) => {
    const connected = roomConnectedV6Schema.safeParse(raw);
    if (connected.success) {
      value.connected.push(connected.data);
      return;
    }
    const rejection = commandRejectedV6Schema.safeParse(raw);
    if (rejection.success)
      value.rejections.push(rejection.data as CommandRejectedV6);
  });
  room.onMessage<unknown>(ROOM_CONTROL_MESSAGE, (raw) => {
    const lifecycle = roomLifecycleStateV6Schema.safeParse(raw);
    if (lifecycle.success) value.lifecycle.push(lifecycle.data);
  });
  room.onMessage<unknown>(REALTIME_SERVER_MESSAGE, (raw) => {
    const snapshot = realtimeSnapshotSchema.safeParse(raw);
    if (snapshot.success) {
      value.snapshots.push(snapshot.data);
      return;
    }
    const rejection = realtimeRejectedSchema.safeParse(raw);
    if (rejection.success)
      value.realtimeRejections.push(rejection.data as RealtimeRejected);
  });
  return value;
}

function messages(room: ClientRoom): RoomMessages {
  const value: RoomMessages = {
    connected: [],
    lifecycle: [],
    snapshots: [],
    rejections: [],
  };
  room.onMessage<unknown>(SERVER_PROTOCOL_MESSAGE, (raw) => {
    const parsed = roomConnectedSchema.safeParse(raw);
    if (parsed.success) {
      value.connected.push(parsed.data);
      return;
    }
    // Realtime control rejections intentionally use the existing protocol
    // channel, while input rejections use the realtime channel.
  });
  room.onMessage<unknown>(ROOM_CONTROL_MESSAGE, (raw) => {
    const parsed = roomLifecycleStateSchema.safeParse(raw);
    if (parsed.success) value.lifecycle.push(parsed.data);
  });
  room.onMessage<unknown>(REALTIME_SERVER_MESSAGE, (raw) => {
    const snapshot = realtimeSnapshotSchema.safeParse(raw);
    if (snapshot.success) {
      value.snapshots.push(snapshot.data);
      return;
    }
    const rejection = realtimeRejectedSchema.safeParse(raw);
    if (rejection.success)
      value.rejections.push(rejection.data as RealtimeRejected);
  });
  return value;
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMilliseconds = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!(await predicate())) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for realtime state.");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function control(
  commandId: string,
  operation: "SELECT_STARTER" | "READY_FOR_ROUND" | "CLOSE_ROOM",
) {
  return {
    type: "room.control",
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    operation,
    ...(operation === "SELECT_STARTER" ? { starter: "OWNER" as const } : {}),
  };
}

function input(commandId: string, sequence: number, value: unknown) {
  return {
    type: "realtime.input",
    realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
    commandId,
    roundNumber: 1,
    inputSequence: sequence,
    input: value,
  };
}

describe.sequential("realtime Pong Game Server", () => {
  const clock = new FakeRuntimeClock(1_000_000);
  const schedulerTimer = new ManualSchedulerTimer();
  const authority = new TestTicketAuthority({
    issuer: "realtime-integration",
    secret: "realtime-integration-secret",
    clock,
    lifetimeSeconds: 600,
  });
  const replayStore = new InMemoryRealtimeReplayStore();
  const roomStore = new InMemoryRealtimeRoomStore();
  const archive = new RecordingRealtimeArchive();
  let roomCodeSequence = 0;
  const ids: RealtimeRuntimeIdSource = {
    // The platform room-code alphabet intentionally excludes I/O to avoid
    // ambiguous invite codes.
    createRoomCode: () => (roomCodeSequence++ === 0 ? "PANG2345" : "PANG2346"),
    createReplayId: () => "realtime-replay-1",
    createSetupRngSeed: () => "realtime-setup-seed-1",
    createRngSeed: () => "realtime-seed-1",
    createPlayerSlotId: (index) => `slot-${index + 1}` as never,
  };
  let app: GameServerApplication;
  let address: GameServerAddress;

  beforeAll(async () => {
    app = createGameServer({
      ticketVerifier: authority,
      realtimeTicketVerifier: authority,
      realtimeReplayStore: replayStore,
      realtimeRoomStore: roomStore,
      realtimeMatchArchive: archive,
      realtimeClock: clock as unknown as RealtimeRuntimeClock,
      realtimeIds: ids,
      realtimeSchedulerTimer: schedulerTimer,
      realtimeReconnectGraceMilliseconds: 60_000,
      realtimeTerminalRoomTtlMilliseconds: 300_000,
      resolveCurrentRealtimeDefinition: (gameId) =>
        resolveRealtimeGameDefinition(gameId, "1.0.0"),
      resolveSetupProtocol: (gameId, gameVersion) =>
        gameId === "pong" && gameVersion === "1.0.0"
          ? PROTOCOL_VERSION
          : undefined,
      logger: { write: () => undefined },
    });
    address = await app.start({ port: 0 });
  });

  afterAll(async () => {
    await app?.stop();
  });

  it("runs authoritative create/join/ready/input/reconnect/complete flow", async () => {
    const clientA = new ColyseusClient(address.httpUrl);
    const clientB = new ColyseusClient(address.httpUrl);
    const roomA = await clientA.create(REALTIME_GAME_ROOM_NAME, {
      type: "room.create",
      protocolVersion: PROTOCOL_VERSION,
      ticket: authority.issue("realtime-a"),
      gameId: "pong",
      initialConfig: { targetScore: 3 },
    });
    const inboxA = messages(roomA);
    await waitUntil(
      () => inboxA.connected.length === 1 && inboxA.lifecycle.length >= 1,
    );
    const discoveryResponse = await fetch(
      `${address.httpUrl}/room-discovery?gameId=pong&roomCode=pang2345`,
    );
    expect(discoveryResponse.status).toBe(200);
    expect(discoveryResponse.headers.get("cache-control")).toBe("no-store");
    const discovery = (await discoveryResponse.json()) as Record<
      string,
      unknown
    >;
    expect(discovery).toEqual({
      roomCode: "PANG2345",
      gameId: "pong",
      gameVersion: "1.0.0",
      setupProtocol: PROTOCOL_VERSION,
      runtime: "realtime",
    });
    expect(Object.keys(discovery).sort()).toEqual([
      "gameId",
      "gameVersion",
      "roomCode",
      "runtime",
      "setupProtocol",
    ]);
    expect(JSON.stringify(discovery)).not.toMatch(/session|slot|ticket/iu);
    const roomB = await clientB.join(REALTIME_GAME_ROOM_NAME, {
      type: "room.join",
      protocolVersion: PROTOCOL_VERSION,
      ticket: authority.issue("realtime-b"),
      roomCode: "PANG2345",
    });
    const inboxB = messages(roomB);
    await waitUntil(
      () => inboxB.connected.length === 1 && inboxB.lifecycle.length >= 1,
    );
    expect(inboxA.connected[0]).toMatchObject({
      playerSlotId: "slot-1",
      roomCode: "PANG2345",
    });
    expect(inboxB.connected[0]).toMatchObject({
      playerSlotId: "slot-2",
      roomCode: "PANG2345",
    });

    roomA.send(ROOM_CONTROL_MESSAGE, control("starter", "SELECT_STARTER"));
    roomA.send(ROOM_CONTROL_MESSAGE, control("ready-a", "READY_FOR_ROUND"));
    roomB.send(ROOM_CONTROL_MESSAGE, control("ready-b", "READY_FOR_ROUND"));
    await waitUntil(() =>
      inboxA.lifecycle.some((state) => state.currentRound?.status === "active"),
    );
    await waitUntil(() =>
      inboxA.snapshots.some((snapshot) => snapshot.tick === 0),
    );
    await waitUntil(() =>
      inboxB.snapshots.some((snapshot) => snapshot.tick === 0),
    );

    await schedulerTimer.tick();
    await waitUntil(() =>
      inboxA.snapshots.some((snapshot) => snapshot.tick === 1),
    );
    await waitUntil(() =>
      inboxB.snapshots.some((snapshot) => snapshot.tick === 1),
    );
    expect(inboxA.snapshots.at(-1)).toMatchObject({
      tick: 1,
      acknowledgedInputSequence: 0,
    });

    // Strict envelope rejects forged actor/state/position/tick fields without
    // allowing them to reach Pong Core.
    roomA.send(REALTIME_INPUT_MESSAGE, {
      ...input("forged", 1, { type: "DIRECTION", direction: 1 }),
      actorSlotId: "slot-2",
      state: { scores: [9, 9] },
      tick: 999,
    });
    await waitUntil(() =>
      inboxA.rejections.some(
        (rejection) => rejection.code === "INVALID_INPUT_PAYLOAD",
      ),
    );
    expect(inboxA.snapshots.at(-1)?.tick).toBe(1);

    roomA.send(
      REALTIME_INPUT_MESSAGE,
      input("direction", 1, { type: "DIRECTION", direction: -1 }),
    );
    // Let the WebSocket dispatch reach the room writer before advancing the
    // manually controlled server clock. Network delivery is asynchronous even
    // though the simulation clock itself is deterministic.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await schedulerTimer.tick();
    await waitUntil(() =>
      inboxA.snapshots.some(
        (snapshot) => snapshot.acknowledgedInputSequence === 1,
      ),
    );

    roomA.send(
      REALTIME_INPUT_MESSAGE,
      input("direction-duplicate", 1, { type: "DIRECTION", direction: 1 }),
    );
    await waitUntil(() =>
      inboxA.rejections.some(
        (rejection) => rejection.code === "STALE_INPUT_SEQUENCE",
      ),
    );

    // A second connection with the same session takes over the stable slot.
    const clientATakeover = new ColyseusClient(address.httpUrl);
    const roomATakeover = await clientATakeover.join(REALTIME_GAME_ROOM_NAME, {
      type: "room.join",
      protocolVersion: PROTOCOL_VERSION,
      ticket: authority.issue("realtime-a"),
      roomCode: "PANG2345",
    });
    const inboxATakeover = messages(roomATakeover);
    await waitUntil(
      () =>
        inboxATakeover.connected.length === 1 &&
        inboxATakeover.snapshots.some((snapshot) => snapshot.tick === 2),
    );
    expect(inboxATakeover.connected[0]?.playerSlotId).toBe("slot-1");

    roomATakeover.send(
      REALTIME_INPUT_MESSAGE,
      input("resign", 2, { type: "RESIGN" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await schedulerTimer.tick();
    await waitUntil(() =>
      inboxATakeover.snapshots.some((snapshot) => snapshot.outcome !== null),
    );
    await waitUntil(() =>
      inboxB.lifecycle.some(
        (state) => state.currentRound?.status === "completed",
      ),
    );
    const replay = await replayStore.get("realtime-replay-1");
    expect(replay?.finalTick).toBeGreaterThan(0);
    expect(replay?.recordedOutcome).not.toBeNull();
    expect(
      verifyRealtimeReplay(replay, resolveRealtimeGameDefinition),
    ).toMatchObject({ ok: true });
    expect(archive.created).toHaveLength(1);
    expect(archive.saved.at(-1)?.currentRound).toMatchObject({
      status: "completed",
    });
  });

  it("abandonment closes an active room after the reconnect grace window", async () => {
    const clientA = new ColyseusClient(address.httpUrl);
    const clientB = new ColyseusClient(address.httpUrl);
    const roomA = await clientA.create(REALTIME_GAME_ROOM_NAME, {
      type: "room.create",
      protocolVersion: PROTOCOL_VERSION,
      ticket: authority.issue("abandon-a"),
      gameId: "pong",
      initialConfig: { targetScore: 3 },
    });
    const inboxA = messages(roomA);
    await waitUntil(() => inboxA.connected.length === 1);
    const roomB = await clientB.join(REALTIME_GAME_ROOM_NAME, {
      type: "room.join",
      protocolVersion: PROTOCOL_VERSION,
      ticket: authority.issue("abandon-b"),
      roomCode: "PANG2346",
    });
    const inboxB = messages(roomB);
    await waitUntil(() => inboxB.connected.length === 1);
    roomA.send(
      ROOM_CONTROL_MESSAGE,
      control("abandon-starter", "SELECT_STARTER"),
    );
    roomA.send(
      ROOM_CONTROL_MESSAGE,
      control("abandon-ready-a", "READY_FOR_ROUND"),
    );
    roomB.send(
      ROOM_CONTROL_MESSAGE,
      control("abandon-ready-b", "READY_FOR_ROUND"),
    );
    await waitUntil(() =>
      inboxA.lifecycle.some((state) => state.currentRound?.status === "active"),
    );
    await roomB.leave(false);
    await waitUntil(async () => {
      const stored = await roomStore.getByRoomCode("PANG2346");
      const reservedUntil = stored?.players[1]?.reservedUntilMilliseconds;
      return reservedUntil !== null && reservedUntil !== undefined;
    });
    clock.advanceBy(60_000);
    await waitUntil(() => inboxA.lifecycle.some((state) => state.closed));
    expect(inboxA.lifecycle.at(-1)).toMatchObject({
      closed: true,
      closeReason: "RECONNECT_TIMEOUT",
    });
  });
});

describe.sequential("realtime Pong Protocol V6 setup", () => {
  const clock = new FakeRuntimeClock(2_000_000);
  const schedulerTimer = new ManualSchedulerTimer();
  const authority = new TestTicketAuthority({
    issuer: "realtime-v6-integration",
    secret: "realtime-v6-integration-secret",
    clock,
    lifetimeSeconds: 600,
  });
  const replayStore = new InMemoryRealtimeReplayStore();
  const roomStore = new InMemoryRealtimeRoomStore();
  const archive = new RecordingRealtimeArchive();
  const gameplaySeeds: string[] = [];
  const setupSeeds: string[] = [];
  const pongDefinition = resolveRealtimeGameDefinition("pong", "1.2.0");
  if (pongDefinition === undefined) {
    throw new Error("Pong realtime definition is unavailable.");
  }
  let failNextSimulationStep = false;
  const v6PongDefinition: typeof pongDefinition = {
    ...pongDefinition,
    step(context) {
      if (failNextSimulationStep) {
        failNextSimulationStep = false;
        throw new Error("simulated realtime Core failure");
      }
      return pongDefinition.step(context);
    },
  };
  let replaySequence = 0;
  const ids: RealtimeRuntimeIdSource = {
    createRoomCode: () => "VSPN2345",
    createReplayId: () => `realtime-v6-replay-${++replaySequence}`,
    createSetupRngSeed: () => {
      const seed = `realtime-v6-setup-${setupSeeds.length + 1}`;
      setupSeeds.push(seed);
      return seed;
    },
    createRngSeed: () => {
      const seed = `realtime-v6-gameplay-${gameplaySeeds.length + 1}`;
      gameplaySeeds.push(seed);
      return seed;
    },
    createPlayerSlotId: (index) => `v6-slot-${index + 1}` as never,
  };
  let app: GameServerApplication;
  let address: GameServerAddress;

  const ticket = (session: string) =>
    authority.issue(session, { protocolVersion: SETUP_PROTOCOL_VERSION });
  const setupCommand = (
    commandId: string,
    expectedSetupRevision: number,
    starter: "OWNER" | "NON_OWNER" | "RANDOM",
  ) => ({
    type: "game.setup" as const,
    protocolVersion: SETUP_PROTOCOL_VERSION,
    commandId,
    roundNumber: 1,
    expectedSetupRevision,
    action: { type: "SELECT_STARTER" as const, starter },
  });
  const readyCommand = (commandId: string) => ({
    type: "room.control" as const,
    protocolVersion: SETUP_PROTOCOL_VERSION,
    commandId,
    operation: "READY_FOR_ROUND" as const,
  });

  beforeAll(async () => {
    app = createGameServer({
      ticketVerifier: authority,
      realtimeTicketVerifier: authority,
      realtimeReplayStore: replayStore,
      realtimeRoomStore: roomStore,
      realtimeMatchArchive: archive,
      realtimeClock: clock as unknown as RealtimeRuntimeClock,
      realtimeIds: ids,
      realtimeSchedulerTimer: schedulerTimer,
      resolveCurrentRealtimeDefinition: (gameId) =>
        gameId === "pong" ? v6PongDefinition : undefined,
      resolveRealtimeDefinition: (gameId, gameVersion) =>
        gameId === "pong" && gameVersion === "1.2.0"
          ? v6PongDefinition
          : undefined,
      resolveSetupProtocol: (gameId, gameVersion) =>
        gameId === "pong" && gameVersion === "1.2.0"
          ? SETUP_PROTOCOL_VERSION
          : undefined,
      logger: { write: () => undefined },
    });
    address = await app.start({ port: 0 });
  });

  afterAll(async () => {
    await app?.stop();
  });

  it("pins V6, finalizes setup, clears ready on changes and reuses the full setup", async () => {
    const clientA = new ColyseusClient(address.httpUrl);
    await expect(
      clientA.create(REALTIME_GAME_ROOM_NAME, {
        type: "room.create",
        protocolVersion: PROTOCOL_VERSION,
        ticket: authority.issue("v6-owner"),
        gameId: "pong",
        initialConfig: { targetScore: 3 },
      }),
    ).rejects.toBeDefined();

    const roomA = await clientA.create(REALTIME_GAME_ROOM_NAME, {
      type: "room.create",
      protocolVersion: SETUP_PROTOCOL_VERSION,
      ticket: ticket("v6-owner"),
      gameId: "pong",
      initialConfig: { targetScore: 3 },
    });
    const inboxA = messagesV6(roomA);
    await waitUntil(
      () => inboxA.connected.length === 1 && inboxA.lifecycle.length >= 1,
    );
    expect(inboxA.lifecycle.at(-1)?.nextRound).toMatchObject({
      roundNumber: 1,
      setupRevision: 0,
      setupView: { starter: "UNSELECTED", canEdit: true },
      readiness: { canReady: false, readySlotIds: [] },
    });

    const clientB = new ColyseusClient(address.httpUrl);
    const roomB = await clientB.join(REALTIME_GAME_ROOM_NAME, {
      type: "room.join",
      protocolVersion: SETUP_PROTOCOL_VERSION,
      ticket: ticket("v6-guest"),
      roomCode: "VSPN2345",
    });
    const inboxB = messagesV6(roomB);
    await waitUntil(
      () => inboxB.connected.length === 1 && inboxB.lifecycle.length >= 1,
    );
    expect(inboxB.lifecycle.at(-1)?.nextRound?.setupView).toMatchObject({
      canEdit: false,
      participantSlotIds: ["v6-slot-1", "v6-slot-2"],
    });

    roomB.send(GAME_SETUP_MESSAGE, setupCommand("guest-forged", 0, "OWNER"));
    await waitUntil(() => inboxB.rejections.length >= 1);
    expect(inboxB.rejections.at(-1)).toMatchObject({
      code: "SETUP_RULE_REJECTED",
      setupRevision: 0,
      gameRuleCode: "NOT_OWNER",
    });

    roomA.send(GAME_SETUP_MESSAGE, setupCommand("owner-first", 0, "OWNER"));
    await waitUntil(() =>
      inboxA.lifecycle.some((state) => state.nextRound?.setupRevision === 1),
    );
    roomA.send(GAME_SETUP_MESSAGE, setupCommand("owner-stale", 0, "RANDOM"));
    await waitUntil(() =>
      inboxA.rejections.some(
        (rejection) => rejection.code === "STALE_SETUP_REVISION",
      ),
    );
    expect(inboxA.rejections.at(-1)).toMatchObject({
      setupRevision: 1,
    });

    roomA.send(ROOM_CONTROL_MESSAGE, readyCommand("ready-before-change"));
    await waitUntil(() =>
      inboxA.lifecycle.some(
        (state) => state.nextRound?.readiness.readySlotIds.length === 1,
      ),
    );
    roomA.send(
      GAME_SETUP_MESSAGE,
      setupCommand("change-clears-ready", 1, "NON_OWNER"),
    );
    await waitUntil(() =>
      inboxA.lifecycle.some(
        (state) =>
          state.nextRound?.setupRevision === 2 &&
          state.nextRound.readiness.readySlotIds.length === 0,
      ),
    );
    roomA.send(GAME_SETUP_MESSAGE, setupCommand("restore-owner", 2, "OWNER"));
    await waitUntil(() =>
      inboxA.lifecycle.some((state) => state.nextRound?.setupRevision === 3),
    );
    roomA.send(ROOM_CONTROL_MESSAGE, readyCommand("ready-owner"));
    roomB.send(ROOM_CONTROL_MESSAGE, readyCommand("ready-guest"));
    await waitUntil(() =>
      inboxA.lifecycle.some((state) => state.currentRound?.status === "active"),
    );
    await waitUntil(() =>
      inboxA.snapshots.some((snapshot) => snapshot.tick === 0),
    );

    expect(setupSeeds).toEqual(["realtime-v6-setup-1"]);
    expect(gameplaySeeds).toEqual(["realtime-v6-gameplay-1"]);
    const activeStoredRoom = await roomStore.getByRoomCode("VSPN2345");
    expect(activeStoredRoom).toMatchObject({
      setupProtocol: SETUP_PROTOCOL_VERSION,
      previousFinalizedSetup: {
        config: { targetScore: 3 },
        playerOrder: ["v6-slot-1", "v6-slot-2"],
      },
      currentRound: { roundNumber: 1, status: "active" },
    });
    expect(activeStoredRoom).not.toHaveProperty("nextRoundSetup");

    await waitUntil(
      () => inboxA.snapshots.length > 0 && inboxB.snapshots.length > 0,
    );
    for (const inbox of [inboxA, inboxB]) {
      expect(inbox.snapshots.at(-1)).toMatchObject({
        tick: 0,
        view: {
          ball: { x: 400_000, y: 200_000 },
          serve: { ticksRemaining: 120 },
        },
      });
      expect(JSON.stringify(inbox.snapshots.at(-1)?.view)).not.toMatch(
        /velocity|rng|seed|serveTicksRemaining/u,
      );
    }
    for (let tick = 1; tick <= 120; tick += 1) {
      await schedulerTimer.tick();
      await waitUntil(() => inboxA.snapshots.at(-1)?.tick === tick);
      expect(inboxA.snapshots.at(-1)?.view).toMatchObject({
        ball: { x: 400_000, y: 200_000 },
        serve: tick === 120 ? null : { ticksRemaining: 120 - tick },
      });
    }
    await schedulerTimer.tick();
    await waitUntil(() => inboxB.snapshots.at(-1)?.tick === 121);
    expect(inboxB.snapshots.at(-1)?.view).toMatchObject({ serve: null });
    expect(inboxB.snapshots.at(-1)?.view).not.toMatchObject({
      ball: { x: 400_000, y: 200_000 },
    });

    roomA.send(
      REALTIME_INPUT_MESSAGE,
      input("v6-resign", 1, { type: "RESIGN" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await schedulerTimer.tick();
    await waitUntil(() =>
      inboxA.lifecycle.some(
        (state) => state.currentRound?.status === "completed",
      ),
    );
    const completed = await roomStore.getByRoomCode("VSPN2345");
    const replay = await replayStore.get("realtime-v6-replay-1");
    expect(replay?.header.gameVersion).toBe("1.2.0");
    expect(
      verifyRealtimeReplay(replay, resolveRealtimeGameDefinition),
    ).toMatchObject({ ok: true });
    expect(completed).toMatchObject({
      currentRound: { roundNumber: 1, status: "completed" },
      nextRoundSetup: {
        setupRevision: 0,
        readySlotIds: [],
        setupState: {
          config: { targetScore: 3 },
          starter: "FIXED",
          fixedStarterSlotId: "v6-slot-1",
        },
      },
    });
    expect(setupSeeds).toEqual(["realtime-v6-setup-1", "realtime-v6-setup-2"]);

    const nextA = inboxA.lifecycle.at(-1)?.nextRound;
    const nextB = inboxB.lifecycle.at(-1)?.nextRound;
    expect(nextA?.readiness.selfReady).toBe(false);
    expect(nextB?.readiness.selfReady).toBe(false);
    roomA.send(ROOM_CONTROL_MESSAGE, readyCommand("round-2-owner"));
    await waitUntil(() =>
      inboxA.lifecycle.some(
        (state) => state.nextRound?.readiness.readySlotIds.length === 1,
      ),
    );
    expect(
      inboxA.lifecycle.some((state) => state.currentRound?.roundNumber === 2),
    ).toBe(false);
    roomB.send(ROOM_CONTROL_MESSAGE, readyCommand("round-2-guest"));
    await waitUntil(() =>
      inboxA.lifecycle.some(
        (state) =>
          state.currentRound?.roundNumber === 2 &&
          state.currentRound.status === "active",
      ),
    );
    expect(gameplaySeeds).toEqual([
      "realtime-v6-gameplay-1",
      "realtime-v6-gameplay-2",
    ]);
    expect(archive.created.at(-1)?.currentRound?.playerOrder).toEqual([
      "v6-slot-1",
      "v6-slot-2",
    ]);
    expect(archive.created.at(-1)?.currentRound?.replayId).toBe(
      "realtime-v6-replay-2",
    );

    failNextSimulationStep = true;
    await schedulerTimer.tick();
    expect(failNextSimulationStep).toBe(false);
    await waitUntil(async () => {
      const stored = await roomStore.getByRoomCode("VSPN2345");
      return stored?.currentRound?.status === "abandoned";
    });
    expect(await roomStore.getByRoomCode("VSPN2345")).toMatchObject({
      currentRound: { roundNumber: 2, status: "abandoned" },
    });
    await waitUntil(() =>
      inboxA.lifecycle.some(
        (state) =>
          state.currentRound?.roundNumber === 2 &&
          state.currentRound.status === "abandoned" &&
          state.nextRound !== null,
      ),
    );
    expect(inboxA.lifecycle.at(-1)?.nextRound).toMatchObject({
      roundNumber: 3,
      setupRevision: 0,
      setupView: {
        starter: "FIXED",
        fixedStarterSlotId: "v6-slot-1",
      },
      readiness: { readySlotIds: [] },
    });
    expect(await roomStore.getByRoomCode("VSPN2345")).toMatchObject({
      currentRound: { roundNumber: 2, status: "abandoned" },
      nextRoundSetup: {
        setupRevision: 0,
        setupState: {
          starter: "FIXED",
          fixedStarterSlotId: "v6-slot-1",
        },
      },
    });

    await roomA.leave(true);
    await roomB.leave(true);
  });
});

describe.sequential("realtime badminton Protocol V6", () => {
  const clock = new FakeRuntimeClock(3_000_000);
  const schedulerTimer = new ManualSchedulerTimer();
  const authority = new TestTicketAuthority({
    issuer: "badminton-integration",
    secret: "badminton-integration-secret",
    clock,
    lifetimeSeconds: 600,
  });
  const replayStore = new InMemoryRealtimeReplayStore();
  const roomStore = new InMemoryRealtimeRoomStore();
  const archive = new RecordingRealtimeArchive();
  let replaySequence = 0;
  let seedSequence = 0;
  let setupSeedSequence = 0;
  let app: GameServerApplication;
  let address: GameServerAddress;

  const ticket = (session: string) =>
    authority.issue(session, { protocolVersion: SETUP_PROTOCOL_VERSION });
  const ready = (commandId: string) => ({
    type: "room.control",
    protocolVersion: SETUP_PROTOCOL_VERSION,
    commandId,
    operation: "READY_FOR_ROUND",
  });
  const setup = (
    commandId: string,
    expectedSetupRevision: number,
    action: unknown,
  ) => ({
    type: "game.setup",
    protocolVersion: SETUP_PROTOCOL_VERSION,
    commandId,
    roundNumber: 1,
    expectedSetupRevision,
    action,
  });
  const view = (inbox: RoomMessagesV6) =>
    inbox.snapshots.at(-1)?.view as {
      athletes: [{ x: number; y: number }, { x: number; y: number }];
      scores: [number, number];
    };

  async function deliveryBarrier(
    room: ClientRoom,
    inbox: RoomMessagesV6,
  ): Promise<void> {
    const count = inbox.realtimeRejections.length;
    // WebSocket messages and the room writer are ordered. A rejected envelope
    // confirms earlier inputs arrived without advancing the simulation clock.
    room.send(REALTIME_INPUT_MESSAGE, { testBarrier: true });
    await waitUntil(() => inbox.realtimeRejections.length > count);
  }

  async function advance(inbox: RoomMessagesV6): Promise<void> {
    const tick = inbox.snapshots.at(-1)?.tick ?? 0;
    await schedulerTimer.tick();
    await waitUntil(() => (inbox.snapshots.at(-1)?.tick ?? 0) > tick);
  }

  beforeAll(async () => {
    app = createGameServer({
      ticketVerifier: authority,
      realtimeTicketVerifier: authority,
      realtimeReplayStore: replayStore,
      realtimeRoomStore: roomStore,
      realtimeMatchArchive: archive,
      realtimeClock: clock as unknown as RealtimeRuntimeClock,
      realtimeSchedulerTimer: schedulerTimer,
      realtimeIds: {
        createRoomCode: () => "BDMN2345",
        createReplayId: () => `badminton-replay-${++replaySequence}`,
        createSetupRngSeed: () => `badminton-setup-${++setupSeedSequence}`,
        createRngSeed: () => `badminton-gameplay-${++seedSequence}`,
        createPlayerSlotId: (index) => `badminton-slot-${index + 1}` as never,
      },
      logger: { write: () => undefined },
    });
    address = await app.start({ port: 0 });
  });

  afterAll(async () => {
    await app?.stop();
  });

  it("validates setup and input authority, reconnects, resigns, rematches and scores with exact replay", async () => {
    const roomA = await new ColyseusClient(address.httpUrl).create(
      REALTIME_GAME_ROOM_NAME,
      {
        type: "room.create",
        protocolVersion: SETUP_PROTOCOL_VERSION,
        ticket: ticket("badminton-owner"),
        gameId: "badminton",
        initialConfig: { targetScore: 7 },
      },
    );
    const inboxA = messagesV6(roomA);
    await waitUntil(() => inboxA.lifecycle.length > 0);
    expect(inboxA.lifecycle.at(-1)?.nextRound).toMatchObject({
      setupRevision: 0,
      setupView: {
        starter: "OWNER",
        config: { targetScore: 7 },
        canEdit: true,
      },
      readiness: { canReady: false, readySlotIds: [] },
    });
    const discovery = await fetch(
      `${address.httpUrl}/room-discovery?gameId=badminton&roomCode=bdmn2345`,
    );
    expect(await discovery.json()).toEqual({
      roomCode: "BDMN2345",
      gameId: "badminton",
      gameVersion: "1.2.0",
      setupProtocol: SETUP_PROTOCOL_VERSION,
      runtime: "realtime",
    });

    const roomB = await new ColyseusClient(address.httpUrl).join(
      REALTIME_GAME_ROOM_NAME,
      {
        type: "room.join",
        protocolVersion: SETUP_PROTOCOL_VERSION,
        ticket: ticket("badminton-guest"),
        roomCode: "BDMN2345",
      },
    );
    const inboxB = messagesV6(roomB);
    await waitUntil(() => inboxB.lifecycle.length > 0);
    expect(inboxB.lifecycle.at(-1)?.nextRound).toMatchObject({
      setupView: { canEdit: false },
      readiness: { canReady: true },
    });
    roomB.send(
      GAME_SETUP_MESSAGE,
      setup("guest-score", 0, { type: "SET_TARGET_SCORE", targetScore: 21 }),
    );
    await waitUntil(() => inboxB.rejections.length > 0);
    expect(inboxB.rejections.at(-1)).toMatchObject({
      code: "SETUP_RULE_REJECTED",
      gameRuleCode: "NOT_OWNER",
      setupRevision: 0,
    });

    roomA.send(ROOM_CONTROL_MESSAGE, ready("ready-before-change"));
    await waitUntil(
      () => inboxA.lifecycle.at(-1)?.nextRound?.readiness.selfReady === true,
    );
    roomA.send(
      GAME_SETUP_MESSAGE,
      setup("eleven", 0, { type: "SET_TARGET_SCORE", targetScore: 11 }),
    );
    await waitUntil(
      () => inboxA.lifecycle.at(-1)?.nextRound?.setupRevision === 1,
    );
    expect(inboxA.lifecycle.at(-1)?.nextRound).toMatchObject({
      setupView: { config: { targetScore: 11 } },
      readiness: { readySlotIds: [] },
    });
    roomA.send(
      GAME_SETUP_MESSAGE,
      setup("stale-score", 0, { type: "SET_TARGET_SCORE", targetScore: 21 }),
    );
    await waitUntil(() => inboxA.rejections.length > 0);
    expect(inboxA.rejections.at(-1)?.code).toBe("STALE_SETUP_REVISION");
    roomA.send(
      GAME_SETUP_MESSAGE,
      setup("invalid-score", 1, { type: "SET_TARGET_SCORE", targetScore: 100 }),
    );
    await waitUntil(() => inboxA.rejections.length > 1);
    expect(inboxA.lifecycle.at(-1)?.nextRound?.setupRevision).toBe(1);
    roomA.send(
      GAME_SETUP_MESSAGE,
      setup("seven", 1, { type: "SET_TARGET_SCORE", targetScore: 7 }),
    );
    await waitUntil(
      () => inboxA.lifecycle.at(-1)?.nextRound?.setupRevision === 2,
    );
    roomA.send(
      GAME_SETUP_MESSAGE,
      setup("guest-first", 2, { type: "SELECT_STARTER", starter: "NON_OWNER" }),
    );
    await waitUntil(
      () => inboxA.lifecycle.at(-1)?.nextRound?.setupRevision === 3,
    );
    roomA.send(ROOM_CONTROL_MESSAGE, ready("ready-a"));
    roomB.send(ROOM_CONTROL_MESSAGE, ready("ready-b"));
    await waitUntil(
      () => inboxA.snapshots.length > 0 && inboxB.snapshots.length > 0,
    );
    expect(inboxA.snapshots.at(-1)?.view).toMatchObject({
      yourSide: "RIGHT",
      servingSide: "LEFT",
      players: [
        { slotId: "badminton-slot-2", side: "LEFT" },
        { slotId: "badminton-slot-1", side: "RIGHT" },
      ],
      scores: [0, 0],
      targetScore: 7,
    });
    expect(inboxB.snapshots.at(-1)?.view).toMatchObject({ yourSide: "LEFT" });
    expect(JSON.stringify(inboxA.snapshots.at(-1)?.view)).not.toMatch(
      /velocity|controls|inputAge|rng|seed|session|ticket|events/iu,
    );

    for (const payload of [
      {
        ...input("forged-actor", 1, { type: "RESIGN" }),
        actorSlotId: "badminton-slot-2",
        state: { scores: [7, 0] },
        tick: 10_000,
      },
      input("forged-position", 1, {
        type: "CONTROL",
        move: 1,
        jump: false,
        serve: false,
        shot: "CLEAR",
        x: 900_000,
      }),
      input("invalid-direction", 1, {
        type: "CONTROL",
        move: 2,
        jump: false,
        serve: false,
        shot: "CLEAR",
      }),
      input("forged-outcome", 1, { type: "RESIGN", scores: [7, 0] }),
    ]) {
      const count = inboxA.realtimeRejections.length;
      roomA.send(REALTIME_INPUT_MESSAGE, payload);
      await waitUntil(() => inboxA.realtimeRejections.length > count);
      expect(inboxA.realtimeRejections.at(-1)?.code).toBe(
        "INVALID_INPUT_PAYLOAD",
      );
    }
    expect(inboxA.snapshots.at(-1)?.tick).toBe(0);
    const initialAthlete = { ...view(inboxA).athletes[1] };
    const movement = input("control-a", 1, {
      type: "CONTROL",
      move: -1,
      jump: true,
      serve: false,
      shot: "CLEAR",
    });
    roomA.send(REALTIME_INPUT_MESSAGE, movement);
    roomA.send(REALTIME_INPUT_MESSAGE, movement);
    await deliveryBarrier(roomA, inboxA);
    await advance(inboxA);
    expect(inboxA.snapshots.at(-1)?.acknowledgedInputSequence).toBe(1);
    expect(view(inboxA).athletes[1].x).toBeLessThan(initialAthlete.x);
    expect(view(inboxA).athletes[1].y).toBeLessThan(initialAthlete.y);
    expect((await replayStore.get("badminton-replay-1"))?.events).toHaveLength(
      1,
    );

    roomB.send(REALTIME_INPUT_MESSAGE, movement);
    await waitUntil(() => inboxB.realtimeRejections.length > 0);
    expect(inboxB.realtimeRejections.at(-1)?.code).toBe("DUPLICATE_COMMAND");
    roomA.send(
      REALTIME_INPUT_MESSAGE,
      input("stale-input", 1, { type: "RESIGN" }),
    );
    await waitUntil(
      () => inboxA.realtimeRejections.at(-1)?.code === "STALE_INPUT_SEQUENCE",
    );
    roomA.send(REALTIME_INPUT_MESSAGE, {
      ...input("wrong-round", 2, { type: "RESIGN" }),
      roundNumber: 2,
    });
    await waitUntil(
      () => inboxA.realtimeRejections.at(-1)?.code === "ROUND_MISMATCH",
    );
    expect((await replayStore.get("badminton-replay-1"))?.events).toHaveLength(
      1,
    );

    roomA.send(
      REALTIME_INPUT_MESSAGE,
      input("release-a", 2, {
        type: "CONTROL",
        move: 0,
        jump: false,
        serve: false,
        shot: "NONE",
      }),
    );
    await deliveryBarrier(roomA, inboxA);
    await advance(inboxA);
    const stoppedX = view(inboxA).athletes[1].x;
    await advance(inboxA);
    expect(view(inboxA).athletes[1].x).toBe(stoppedX);

    const takeover = await new ColyseusClient(address.httpUrl).join(
      REALTIME_GAME_ROOM_NAME,
      {
        type: "room.join",
        protocolVersion: SETUP_PROTOCOL_VERSION,
        ticket: ticket("badminton-owner"),
        roomCode: "BDMN2345",
      },
    );
    const resumed = messagesV6(takeover);
    await waitUntil(
      () => resumed.connected.length > 0 && resumed.snapshots.length > 0,
    );
    expect(resumed.connected[0]?.playerSlotId).toBe("badminton-slot-1");
    expect(resumed.snapshots.at(-1)?.tick).toBe(3);
    expect(view(resumed)).toEqual(view(inboxA));
    takeover.send(
      REALTIME_INPUT_MESSAGE,
      input("resign-a", 3, { type: "RESIGN" }),
    );
    await deliveryBarrier(takeover, resumed);
    await advance(resumed);
    await waitUntil(
      () => resumed.lifecycle.at(-1)?.currentRound?.status === "completed",
    );
    const firstReplay = await replayStore.get("badminton-replay-1");
    expect(firstReplay?.events).toHaveLength(3);
    expect(firstReplay?.recordedRngCursor).toBe(0);
    expect(firstReplay?.recordedOutcome).toMatchObject({
      reason: "RESIGNATION",
      winnerSlotId: "badminton-slot-2",
      resignedSlotId: "badminton-slot-1",
    });
    expect(
      verifyRealtimeReplay(firstReplay, resolveRealtimeGameDefinition),
    ).toMatchObject({ ok: true });
    expect(await roomStore.getByRoomCode("BDMN2345")).toMatchObject({
      nextRoundSetup: {
        setupRevision: 0,
        readySlotIds: [],
        setupState: {
          config: { targetScore: 7 },
          starter: "FIXED",
          fixedStarterSlotId: "badminton-slot-2",
        },
      },
    });

    takeover.send(ROOM_CONTROL_MESSAGE, ready("rematch-a"));
    await waitUntil(
      () => resumed.lifecycle.at(-1)?.nextRound?.readiness.selfReady === true,
    );
    expect(resumed.lifecycle.at(-1)?.currentRound?.roundNumber).toBe(1);
    roomB.send(ROOM_CONTROL_MESSAGE, ready("rematch-b"));
    await waitUntil(() => resumed.snapshots.at(-1)?.roundNumber === 2);
    expect(resumed.snapshots.at(-1)).toMatchObject({
      tick: 0,
      acknowledgedInputSequence: 0,
      view: { scores: [0, 0], yourSide: "RIGHT", targetScore: 7 },
    });
    expect(archive.created).toHaveLength(2);
    expect(archive.created[1]?.currentRound?.playerOrder).toEqual([
      "badminton-slot-2",
      "badminton-slot-1",
    ]);
    expect(seedSequence).toBe(2);
    for (let tick = 0; tick < 240; tick++) await schedulerTimer.tick();
    await waitUntil(() => resumed.snapshots.at(-1)?.tick === 240);
    expect(resumed.snapshots.at(-1)?.view).toMatchObject({
      phase: "SERVE",
      scores: [0, 0],
    });
    takeover.send(REALTIME_INPUT_MESSAGE, {
      ...input("receiver-serve", 1, {
        type: "CONTROL",
        move: 0,
        jump: false,
        serve: true,
        shot: "NONE",
      }),
      roundNumber: 2,
    });
    await deliveryBarrier(takeover, resumed);
    await advance(resumed);
    expect(resumed.snapshots.at(-1)?.view).toMatchObject({
      phase: "SERVE",
      scores: [0, 0],
    });
    let serveSequence = 0;
    for (let point = 0; point < 7; point++) {
      roomB.send(REALTIME_INPUT_MESSAGE, {
        ...input(`manual-serve-${point}`, ++serveSequence, {
          type: "CONTROL",
          move: 0,
          jump: false,
          serve: true,
          shot: "NONE",
        }),
        roundNumber: 2,
      });
      await deliveryBarrier(roomB, inboxB);
      await advance(resumed);
      expect(resumed.snapshots.at(-1)?.view).toMatchObject({
        phase: "SERVING",
        rallyHits: 0,
      });
      for (let tick = 0; tick < 5; tick++) await schedulerTimer.tick();
      await waitUntil(
        () =>
          (resumed.snapshots.at(-1)?.view as { phase: string }).phase ===
          "RALLY",
      );
      roomB.send(REALTIME_INPUT_MESSAGE, {
        ...input(`serve-release-${point}`, ++serveSequence, {
          type: "CONTROL",
          move: 0,
          jump: false,
          serve: false,
          shot: "NONE",
        }),
        roundNumber: 2,
      });
      await deliveryBarrier(roomB, inboxB);
      const initialTick = resumed.snapshots.at(-1)?.tick ?? 0;
      for (let tick = 0; tick < 176; tick++) await schedulerTimer.tick();
      await waitUntil(
        () =>
          resumed.snapshots.at(-1)?.outcome !== null ||
          (resumed.snapshots.at(-1)?.tick ?? 0) >= initialTick + 176,
      );
    }
    await waitUntil(
      () => resumed.lifecycle.at(-1)?.currentRound?.status === "completed",
    );
    const scoredReplay = await replayStore.get("badminton-replay-2");
    expect(scoredReplay?.recordedOutcome).toEqual({
      type: "WIN",
      reason: "SCORE",
      winnerSlotId: "badminton-slot-2",
      scores: [7, 0],
    });
    expect(
      scoredReplay?.events.filter(
        (event) =>
          (event.input as { serve?: boolean }).serve &&
          event.actorSlotId === "badminton-slot-2",
      ),
    ).toHaveLength(7);
    expect(scoredReplay?.recordedRngCursor).toBe(0);
    expect(scoredReplay?.header.rng.seed).not.toBe(
      firstReplay?.header.rng.seed,
    );
    expect(
      verifyRealtimeReplay(scoredReplay, resolveRealtimeGameDefinition),
    ).toMatchObject({ ok: true });
    expect(archive.saved.at(-1)?.currentRound?.status).toBe("completed");
    await takeover.leave(true);
    await roomB.leave(true);
  }, 30_000);
});
