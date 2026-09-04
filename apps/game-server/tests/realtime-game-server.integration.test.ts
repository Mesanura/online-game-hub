import { Client as ColyseusClient } from "@colyseus/sdk";
import type { Room as ClientRoom } from "@colyseus/sdk";
import {
  REALTIME_GAME_ROOM_NAME,
  REALTIME_INPUT_MESSAGE,
  REALTIME_SERVER_MESSAGE,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  PROTOCOL_VERSION,
  REALTIME_PROTOCOL_VERSION,
  realtimeRejectedSchema,
  realtimeSnapshotSchema,
  roomLifecycleStateSchema,
  roomConnectedSchema,
} from "@online-game-hub/protocol";
import type {
  RealtimeRejected,
  RealtimeSnapshot,
  RoomLifecycleState,
  RoomConnected,
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
