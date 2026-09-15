import { readFileSync } from "node:fs";
import { Client as ColyseusClient } from "@colyseus/sdk";
import type { Room as ClientRoom } from "@colyseus/sdk";
import {
  REALTIME_GAME_ROOM_NAME,
  GAME_SETUP_MESSAGE,
  REALTIME_INPUT_MESSAGE,
  REALTIME_SERVER_MESSAGE,
  ROOM_CONTROL_MESSAGE,
  ROOM_PROFILE_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  SETUP_PROTOCOL_VERSION,
  REALTIME_PROTOCOL_VERSION,
  realtimeRejectedSchema,
  realtimeSnapshotSchema,
  roomLifecycleStateV6Schema,
  roomConnectedV6Schema,
  commandRejectedV6Schema,
} from "@online-game-hub/protocol";
import type {
  CommandRejectedV6,
  RealtimeRejected,
  RealtimeSnapshot,
  RoomLifecycleStateV6,
  RoomConnectedV6,
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
import {
  verifyRealtimeReplay,
  type RealtimeCanonicalReplay,
} from "@online-game-hub/realtime-game-sdk";
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
  readonly connected: RoomConnectedV6[];
  readonly lifecycle: RoomLifecycleStateV6[];
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
    const parsed = roomConnectedV6Schema.safeParse(raw);
    if (parsed.success) {
      value.connected.push(parsed.data);
      return;
    }
    // Realtime control rejections intentionally use the existing protocol
    // channel, while input rejections use the realtime channel.
  });
  room.onMessage<unknown>(ROOM_CONTROL_MESSAGE, (raw) => {
    const parsed = roomLifecycleStateV6Schema.safeParse(raw);
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

describe.sequential("Ninja Clash multiplayer Protocol V6", () => {
  it.each([2, 3, 4])(
    "runs %i clients through exact combat, authority, takeover and rematch",
    async (count) => {
      const fixture = JSON.parse(
        readFileSync(
          new URL(
            `../../../games/ninja-clash/tests/fixtures/ninja-clash-1.0.0-${count}p.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ) as { replay: RealtimeCanonicalReplay };
      const clock = new FakeRuntimeClock(9000000),
        timer = new ManualSchedulerTimer();
      const authority = new TestTicketAuthority({
        issuer: "ninja-integration",
        secret: "ninja-integration-secret",
        clock,
        lifetimeSeconds: 6000,
      });
      const replayStore = new InMemoryRealtimeReplayStore(),
        roomStore = new InMemoryRealtimeRoomStore();
      let serial = 0;
      const app = createGameServer({
        ticketVerifier: authority,
        realtimeTicketVerifier: authority,
        realtimeReplayStore: replayStore,
        realtimeRoomStore: roomStore,
        realtimeClock: clock as unknown as RealtimeRuntimeClock,
        realtimeSchedulerTimer: timer,
        realtimeIds: {
          createRoomCode: () => "NNJA2345",
          createReplayId: () => "ninja-replay-" + ++serial,
          createSetupRngSeed: () => "ninja-setup",
          createRngSeed: () => fixture.replay.header.rng.seed + serial,
          createPlayerSlotId: (i) => `p${i}` as never,
        },
        logger: { write: () => undefined },
      });
      const clients: ClientRoom[] = [],
        boxes: RoomMessagesV6[] = [];
      const sequences = Array.from({ length: count }, () => 0);
      const ticket = (i: number) =>
        authority.issue("ninja-user-" + i, { protocolVersion: 6 });
      const box = (i = 0) => required(boxes[i]);
      const room = (i = 0) => required(clients[i]);
      const barrier = async (i: number) => {
        const n = box(i).realtimeRejections.length;
        room(i).send(REALTIME_INPUT_MESSAGE, { barrier: true });
        await waitUntil(() => box(i).realtimeRejections.length > n);
      };
      let tick = 0;
      const advance = async (n: number) => {
        for (let i = 0; i < n; i++) {
          clock.advanceBy(17);
          await timer.tick();
        }
        tick += n;
        await waitUntil(() =>
          boxes.every((b) => b.snapshots.at(-1)?.tick === tick),
        );
      };
      try {
        const address = await app.start({ port: 0 });
        for (let i = 0; i < count; i++) {
          const client = new ColyseusClient(address.httpUrl);
          clients.push(
            i === 0
              ? await client.create(REALTIME_GAME_ROOM_NAME, {
                  type: "room.create",
                  protocolVersion: 6,
                  ticket: ticket(i),
                  gameId: "ninja-clash",
                  initialConfig: { playerCount: count, targetScore: 5 },
                })
              : await client.join(REALTIME_GAME_ROOM_NAME, {
                  type: "room.join",
                  protocolVersion: 6,
                  ticket: ticket(i),
                  roomCode: "NNJA2345",
                }),
          );
          boxes.push(messagesV6(room(i)));
          await waitUntil(() => box(i).lifecycle.length > 0);
        }
        const setting = {
          type: "game.setup",
          protocolVersion: 6,
          commandId: "set-target",
          roundNumber: 1,
          expectedSetupRevision: 0,
          action: { type: "SET_TARGET_SCORE", targetScore: 3 },
        };
        room(1).send(GAME_SETUP_MESSAGE, {
          ...setting,
          commandId: "guest-target",
        });
        await waitUntil(() => box(1).rejections.length > 0);
        expect(box(1).rejections.at(-1)?.gameRuleCode).toBe("NOT_OWNER");
        room().send(
          ROOM_CONTROL_MESSAGE,
          control("early-ready", "READY_FOR_ROUND"),
        );
        await waitUntil(
          () =>
            box().lifecycle.at(-1)?.nextRound?.readiness.readySlotIds.length ===
            1,
        );
        room().send(GAME_SETUP_MESSAGE, setting);
        await waitUntil(
          () => box().lifecycle.at(-1)?.nextRound?.setupRevision === 1,
        );
        expect(
          box().lifecycle.at(-1)?.nextRound?.readiness.readySlotIds,
        ).toEqual([]);
        room().send(GAME_SETUP_MESSAGE, {
          ...setting,
          commandId: "stale-target",
        });
        await waitUntil(
          () => box().rejections.at(-1)?.code === "STALE_SETUP_REVISION",
        );
        for (let i = 0; i < count; i++)
          room(i).send(
            ROOM_CONTROL_MESSAGE,
            control("ready-" + i, "READY_FOR_ROUND"),
          );
        await waitUntil(() => boxes.every((b) => b.snapshots.length > 0));
        for (const payload of [
          { ...input("forged", 1, { type: "ATTACK" }), actorSlotId: "p1" },
          input("position", 1, { type: "MOVE", direction: 1, x: 0 }),
          input("direction", 1, { type: "MOVE", direction: 2 }),
        ]) {
          const before = box().realtimeRejections.length;
          room().send(REALTIME_INPUT_MESSAGE, payload);
          await waitUntil(() => box().realtimeRejections.length > before);
          expect(box().realtimeRejections.at(-1)?.code).toBe(
            "INVALID_INPUT_PAYLOAD",
          );
        }
        expect((await replayStore.get("ninja-replay-1"))?.events).toEqual([]);
        let resumed = false,
          duplicated = false,
          checkedInputRejections = false;
        for (let index = 0; index < fixture.replay.events.length;) {
          const target = required(fixture.replay.events[index]).tick;
          await advance(target - tick);
          const delivered = new Set<number>();
          let first: ReturnType<typeof input> | null = null;
          while (
            index < fixture.replay.events.length &&
            required(fixture.replay.events[index]).tick === target
          ) {
            const e = required(fixture.replay.events[index++]),
              i = Number(e.actorSlotId.slice(1));
            const command = input(
              "combat-" + index,
              (sequences[i] = (sequences[i] ?? 0) + 1),
              e.input,
            );
            room(i).send(REALTIME_INPUT_MESSAGE, command);
            delivered.add(i);
            first ??= command;
          }
          if (!duplicated && first) {
            const ownerIndex = Number(
              required(fixture.replay.events[0]).actorSlotId.slice(1),
            );
            room(ownerIndex).send(REALTIME_INPUT_MESSAGE, first);
            duplicated = true;
          }
          for (const i of delivered) await barrier(i);
          await advance(1);
          if (!checkedInputRejections) {
            for (const [command, code] of [
              [
                input("ninja-stale", required(sequences[0]), {
                  type: "ATTACK",
                }),
                "STALE_INPUT_SEQUENCE",
              ],
              [
                {
                  ...input("ninja-wrong-round", required(sequences[0]) + 1, {
                    type: "ATTACK",
                  }),
                  roundNumber: 2,
                },
                "ROUND_MISMATCH",
              ],
            ] as const) {
              room().send(REALTIME_INPUT_MESSAGE, command);
              await waitUntil(
                () => box().realtimeRejections.at(-1)?.code === code,
              );
            }
            checkedInputRejections = true;
          }
          if (!resumed && tick > 300) {
            const replacement = await new ColyseusClient(address.httpUrl).join(
              REALTIME_GAME_ROOM_NAME,
              {
                type: "room.join",
                protocolVersion: 6,
                ticket: ticket(0),
                roomCode: "NNJA2345",
              },
            );
            clients[0] = replacement;
            boxes[0] = messagesV6(replacement);
            await waitUntil(() => box().snapshots.length > 0);
            expect(box().connected[0]?.playerSlotId).toBe("p0");
            expect(box().snapshots.at(-1)?.tick).toBe(tick);
            resumed = true;
          }
        }
        await advance(fixture.replay.finalTick - tick);
        await waitUntil(() =>
          boxes.every(
            (b) => b.lifecycle.at(-1)?.currentRound?.status === "completed",
          ),
        );
        const replay = required(await replayStore.get("ninja-replay-1"));
        expect(replay.recordedOutcome).toEqual(fixture.replay.recordedOutcome);
        expect(replay.events).toHaveLength(fixture.replay.events.length);
        expect(
          verifyRealtimeReplay(replay, resolveRealtimeGameDefinition).ok,
        ).toBe(true);
        const firstView = required(box().snapshots.at(-1)).view as {
          players: unknown[];
        };
        for (const p of firstView.players) {
          expect(p).not.toHaveProperty("leaseUntil");
          expect(p).not.toHaveProperty("move");
        }
        room().send(
          REALTIME_INPUT_MESSAGE,
          input("after-finish", (sequences[0] = (sequences[0] ?? 0) + 1), {
            type: "ATTACK",
          }),
        );
        await barrier(0);
        expect(await replayStore.get("ninja-replay-1")).toEqual(replay);
        for (let i = 0; i < count; i++)
          room(i).send(
            ROOM_CONTROL_MESSAGE,
            control("again-" + i, "READY_FOR_ROUND"),
          );
        await waitUntil(() =>
          boxes.every((b) => b.snapshots.at(-1)?.roundNumber === 2),
        );
        tick = 0;
        expect(
          (await replayStore.get("ninja-replay-2"))?.header.initialConfig,
        ).toEqual({ playerCount: count, targetScore: 3 });
        for (let i = 1; i < count; i++) {
          room(i).send(REALTIME_INPUT_MESSAGE, {
            ...input("resign-" + i, 1, { type: "RESIGN" }),
            roundNumber: 2,
          });
          await barrier(i);
        }
        await advance(1);
        expect(
          verifyRealtimeReplay(
            await replayStore.get("ninja-replay-2"),
            resolveRealtimeGameDefinition,
          ).ok,
        ).toBe(true);
      } finally {
        await Promise.all(clients.map((c) => c.leave().catch(() => undefined)));
        await app.stop();
      }
    },
    60000,
  );
});
async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMilliseconds = 3000,
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
  operation: "READY_FOR_ROUND" | "CLOSE_ROOM",
) {
  return {
    type: "room.control",
    protocolVersion: SETUP_PROTOCOL_VERSION,
    commandId,
    operation,
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
async function liveRealtimeRoomCount(httpUrl: string): Promise<number> {
  const response = await fetch(`${httpUrl}/metrics`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const payload = (await response.json()) as {
    liveRooms: { realtime: { v5: number; v6: number; unknown: number } };
  };
  expect(payload.liveRooms.realtime).toMatchObject({ v5: 0, unknown: 0 });
  return payload.liveRooms.realtime.v6;
}

async function expectLiveRealtimeRooms(
  httpUrl: string,
  count: number,
): Promise<void> {
  await expect.poll(() => liveRealtimeRoomCount(httpUrl)).toBe(count);
}

describe.sequential("realtime Pong Game Server", () => {
  const clock = new FakeRuntimeClock(1000000);
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
    createRoomCode: () => {
      const code = ["PANG2345", "PANG2346", "PANG2347"][roomCodeSequence++];
      if (code === undefined) throw new Error("Test room codes exhausted.");
      return code;
    },
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
      realtimeReconnectGraceMilliseconds: 60000,
      realtimeTerminalRoomTtlMilliseconds: 300000,
      resolveCurrentRealtimeDefinition: (gameId) =>
        resolveRealtimeGameDefinition(gameId, "1.0.0"),
      resolveSetupProtocol: (gameId, gameVersion) =>
        gameId === "pong" && gameVersion === "1.0.0"
          ? SETUP_PROTOCOL_VERSION
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
      protocolVersion: SETUP_PROTOCOL_VERSION,
      ticket: authority.issue("realtime-a"),
      gameId: "pong",
      initialConfig: { targetScore: 3 },
    });
    const inboxA = messages(roomA);
    await waitUntil(
      () => inboxA.connected.length === 1 && inboxA.lifecycle.length >= 1,
    );
    await expectLiveRealtimeRooms(address.httpUrl, 1);
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
      setupProtocol: SETUP_PROTOCOL_VERSION,
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
      protocolVersion: SETUP_PROTOCOL_VERSION,
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
    roomA.send(GAME_SETUP_MESSAGE, {
      type: "game.setup",
      protocolVersion: SETUP_PROTOCOL_VERSION,
      commandId: "starter",
      roundNumber: 1,
      expectedSetupRevision: 0,
      action: { type: "SELECT_STARTER", starter: "OWNER" },
    });
    await waitUntil(
      () => inboxA.lifecycle.at(-1)?.nextRound?.setupRevision === 1,
    );
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
    await expectLiveRealtimeRooms(address.httpUrl, 1);
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
      protocolVersion: SETUP_PROTOCOL_VERSION,
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
    await expectLiveRealtimeRooms(address.httpUrl, 1);
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
    roomATakeover.send(
      ROOM_CONTROL_MESSAGE,
      control("close-completed", "CLOSE_ROOM"),
    );
    await waitUntil(() => inboxATakeover.lifecycle.at(-1)?.closed === true);
    expect(inboxATakeover.lifecycle.at(-1)).toMatchObject({
      causedByCommandId: "close-completed",
      closeReason: "OWNER_CLOSED",
      nextRound: null,
    });
    expect(await roomStore.getByRoomCode("PANG2345")).toMatchObject({
      currentRound: { status: "completed" },
      closeReason: "OWNER_CLOSED",
      nextRoundSetup: { readySlotIds: [] },
    });
    await expectLiveRealtimeRooms(address.httpUrl, 0);
  });
  it("abandonment closes an active room after the reconnect grace window", async () => {
    const initialRoomCount = await liveRealtimeRoomCount(address.httpUrl);
    const clientA = new ColyseusClient(address.httpUrl);
    const clientB = new ColyseusClient(address.httpUrl);
    const roomA = await clientA.create(REALTIME_GAME_ROOM_NAME, {
      type: "room.create",
      protocolVersion: SETUP_PROTOCOL_VERSION,
      ticket: authority.issue("abandon-a"),
      gameId: "pong",
      initialConfig: { targetScore: 3 },
    });
    const inboxA = messages(roomA);
    await waitUntil(() => inboxA.connected.length === 1);
    const roomB = await clientB.join(REALTIME_GAME_ROOM_NAME, {
      type: "room.join",
      protocolVersion: SETUP_PROTOCOL_VERSION,
      ticket: authority.issue("abandon-b"),
      roomCode: "PANG2346",
    });
    const inboxB = messages(roomB);
    await waitUntil(() => inboxB.connected.length === 1);
    roomA.send(GAME_SETUP_MESSAGE, {
      type: "game.setup",
      protocolVersion: SETUP_PROTOCOL_VERSION,
      commandId: "abandon-starter",
      roundNumber: 1,
      expectedSetupRevision: 0,
      action: { type: "SELECT_STARTER", starter: "OWNER" },
    });
    await waitUntil(
      () => inboxA.lifecycle.at(-1)?.nextRound?.setupRevision === 1,
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
    await expectLiveRealtimeRooms(address.httpUrl, initialRoomCount + 1);
    clock.advanceBy(60000);
    await waitUntil(() => inboxA.lifecycle.some((state) => state.closed));
    expect(inboxA.lifecycle.at(-1)).toMatchObject({
      closed: true,
      closeReason: "RECONNECT_TIMEOUT",
    });
    await expectLiveRealtimeRooms(address.httpUrl, initialRoomCount);
  });
  it("acknowledges closing a waiting room while retaining its durable Setup", async () => {
    const room = await new ColyseusClient(address.httpUrl).create(
      REALTIME_GAME_ROOM_NAME,
      {
        type: "room.create",
        protocolVersion: SETUP_PROTOCOL_VERSION,
        ticket: authority.issue("waiting-owner"),
        gameId: "pong",
        initialConfig: { targetScore: 3 },
      },
    );
    const inbox = messages(room);
    await waitUntil(() => inbox.lifecycle.length > 0);
    await expectLiveRealtimeRooms(address.httpUrl, 1);
    room.send(ROOM_CONTROL_MESSAGE, control("close-waiting", "CLOSE_ROOM"));
    await waitUntil(() => inbox.lifecycle.at(-1)?.closed === true);
    expect(inbox.lifecycle.at(-1)).toMatchObject({
      causedByCommandId: "close-waiting",
      currentRound: null,
      nextRound: null,
      closeReason: "OWNER_CLOSED",
    });
    expect(await roomStore.getByRoomCode("PANG2347")).toMatchObject({
      setupProtocol: 6,
      currentRound: null,
      closeReason: "OWNER_CLOSED",
      nextRoundSetup: { readySlotIds: [] },
    });
    await expectLiveRealtimeRooms(address.httpUrl, 0);
  });
});
describe.sequential("realtime Pong Protocol V6 setup", () => {
  const clock = new FakeRuntimeClock(2000000);
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
        protocolVersion: 5,
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
    let roomB = await clientB.join(REALTIME_GAME_ROOM_NAME, {
      type: "room.join",
      protocolVersion: SETUP_PROTOCOL_VERSION,
      ticket: ticket("v6-guest"),
      roomCode: "VSPN2345",
    });
    let inboxB = messagesV6(roomB);
    await waitUntil(
      () => inboxB.connected.length === 1 && inboxB.lifecycle.length >= 1,
    );
    expect(inboxB.lifecycle.at(-1)?.nextRound?.setupView).toMatchObject({
      canEdit: false,
      participantSlotIds: ["v6-slot-1", "v6-slot-2"],
    });
    const beforeRetiredMessages = await roomStore.getByRoomCode("VSPN2345");
    for (const [channel, payload] of [
      [GAME_SETUP_MESSAGE, setupCommand("retired-setup", 0, "OWNER")],
      [ROOM_CONTROL_MESSAGE, readyCommand("retired-control")],
      [
        ROOM_PROFILE_MESSAGE,
        {
          type: ROOM_PROFILE_MESSAGE,
          commandId: "retired-profile",
          ticket: ticket("v6-owner"),
        },
      ],
    ] as const) {
      const rejectionCount = inboxA.rejections.length;
      roomA.send(channel, { ...payload, protocolVersion: 5 });
      await waitUntil(() => inboxA.rejections.length > rejectionCount);
      expect(inboxA.rejections.at(-1)).toMatchObject({
        protocolVersion: 6,
        code: "PROTOCOL_VERSION_UNSUPPORTED",
        retryable: false,
      });
    }
    expect(await roomStore.getByRoomCode("VSPN2345")).toEqual(
      beforeRetiredMessages,
    );

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
    roomA.send(ROOM_CONTROL_MESSAGE, readyCommand("ready-before-score"));
    await waitUntil(
      () => inboxA.lifecycle.at(-1)?.nextRound?.readiness.selfReady === true,
    );
    const beforeScore = (await roomStore.getByRoomCode("VSPN2345"))
      ?.nextRoundSetup;
    expect(beforeScore).toMatchObject({
      setupRevision: 3,
      readySlotIds: ["v6-slot-1"],
      setupRng: { cursor: 0 },
    });
    for (const [id, sender, inbox, revision, action, code, gameRuleCode] of [
      [
        "score-guest",
        roomB,
        inboxB,
        3,
        { type: "SET_TARGET_SCORE", targetScore: 7 },
        "SETUP_RULE_REJECTED",
        "NOT_OWNER",
      ],
      [
        "score-same",
        roomA,
        inboxA,
        3,
        { type: "SET_TARGET_SCORE", targetScore: 3 },
        "SETUP_RULE_REJECTED",
        "SETUP_UNCHANGED",
      ],
      [
        "score-low",
        roomA,
        inboxA,
        3,
        { type: "SET_TARGET_SCORE", targetScore: 0 },
        "INVALID_SETUP_PAYLOAD",
        undefined,
      ],
      [
        "score-high",
        roomA,
        inboxA,
        3,
        { type: "SET_TARGET_SCORE", targetScore: 10 },
        "INVALID_SETUP_PAYLOAD",
        undefined,
      ],
      [
        "score-fraction",
        roomA,
        inboxA,
        3,
        { type: "SET_TARGET_SCORE", targetScore: 1.5 },
        "INVALID_SETUP_PAYLOAD",
        undefined,
      ],
      [
        "score-forged",
        roomA,
        inboxA,
        3,
        { type: "SET_TARGET_SCORE", targetScore: 7, actorSlotId: "v6-slot-1" },
        "INVALID_SETUP_PAYLOAD",
        undefined,
      ],
      [
        "score-stale",
        roomA,
        inboxA,
        2,
        { type: "SET_TARGET_SCORE", targetScore: 7 },
        "STALE_SETUP_REVISION",
        undefined,
      ],
    ] as const) {
      sender.send(GAME_SETUP_MESSAGE, {
        ...setupCommand(id, revision, "OWNER"),
        action,
      });
      await waitUntil(() =>
        inbox.rejections.some((rejection) => rejection.commandId === id),
      );
      expect(
        inbox.rejections.find((rejection) => rejection.commandId === id),
      ).toMatchObject({
        code,
        setupRevision: 3,
        ...(gameRuleCode === undefined ? {} : { gameRuleCode }),
      });
      expect(
        (await roomStore.getByRoomCode("VSPN2345"))?.nextRoundSetup,
      ).toEqual(beforeScore);
    }
    const scoreCommand = {
      ...setupCommand("score-seven", 3, "OWNER"),
      action: { type: "SET_TARGET_SCORE", targetScore: 7 },
    };
    roomA.send(GAME_SETUP_MESSAGE, scoreCommand);
    await waitUntil(
      () => inboxA.lifecycle.at(-1)?.nextRound?.setupRevision === 4,
    );
    expect(inboxA.lifecycle.at(-1)?.nextRound).toMatchObject({
      setupView: { config: { targetScore: 7 }, starter: "OWNER" },
      readiness: { readySlotIds: [] },
    });
    const afterScore = (await roomStore.getByRoomCode("VSPN2345"))
      ?.nextRoundSetup;
    expect(afterScore?.setupRng).toEqual(beforeScore?.setupRng);
    const acknowledgements = inboxA.lifecycle.filter(
      (state) => state.causedByCommandId === "score-seven",
    ).length;
    roomA.send(GAME_SETUP_MESSAGE, scoreCommand);
    await waitUntil(
      () =>
        inboxA.lifecycle.filter(
          (state) => state.causedByCommandId === "score-seven",
        ).length > acknowledgements,
    );
    expect((await roomStore.getByRoomCode("VSPN2345"))?.nextRoundSetup).toEqual(
      afterScore,
    );
    roomB = await clientB.join(REALTIME_GAME_ROOM_NAME, {
      type: "room.join",
      protocolVersion: SETUP_PROTOCOL_VERSION,
      ticket: ticket("v6-guest"),
      roomCode: "VSPN2345",
    });
    inboxB = messagesV6(roomB);
    await waitUntil(
      () => inboxB.connected.length === 1 && inboxB.lifecycle.length > 0,
    );
    expect(inboxB.connected[0]?.playerSlotId).toBe("v6-slot-2");
    expect(inboxB.lifecycle.at(-1)?.nextRound).toMatchObject({
      setupRevision: 4,
      setupView: {
        config: { targetScore: 7 },
        starter: "OWNER",
        canEdit: false,
      },
    });
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
        config: { targetScore: 7 },
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
          targetScore: 7,
          ball: { x: 400000, y: 200000 },
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
        ball: { x: 400000, y: 200000 },
        serve: tick === 120 ? null : { ticksRemaining: 120 - tick },
      });
    }
    await schedulerTimer.tick();
    await waitUntil(() => inboxB.snapshots.at(-1)?.tick === 121);
    expect(inboxB.snapshots.at(-1)?.view).toMatchObject({ serve: null });
    expect(inboxB.snapshots.at(-1)?.view).not.toMatchObject({
      ball: { x: 400000, y: 200000 },
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
    expect(replay?.header.initialConfig).toEqual({ targetScore: 7 });
    expect(replay?.events).toHaveLength(1);
    expect(
      verifyRealtimeReplay(replay, resolveRealtimeGameDefinition),
    ).toMatchObject({ ok: true });
    expect(completed).toMatchObject({
      currentRound: { roundNumber: 1, status: "completed" },
      nextRoundSetup: {
        setupRevision: 0,
        readySlotIds: [],
        setupState: {
          config: { targetScore: 7 },
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
    expect(
      (await replayStore.get("realtime-v6-replay-2"))?.header.initialConfig,
    ).toEqual({ targetScore: 7 });
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
describe.sequential("tank maze multiplayer Protocol V6", () => {
  it.each([2, 3, 8])(
    "runs %i real clients, preserves every FIRE, rebuilds replay and rematches",
    async (count) => {
      const clock = new FakeRuntimeClock(4000000),
        timer = new ManualSchedulerTimer();
      const authority = new TestTicketAuthority({
        issuer: "tank-integration",
        secret: "tank-integration-secret",
        clock,
        lifetimeSeconds: 600,
      });
      const replayStore = new InMemoryRealtimeReplayStore(),
        roomStore = new InMemoryRealtimeRoomStore(),
        archive = new RecordingRealtimeArchive();
      let replayId = 0;
      const app = createGameServer({
        ticketVerifier: authority,
        realtimeTicketVerifier: authority,
        realtimeReplayStore: replayStore,
        realtimeRoomStore: roomStore,
        realtimeMatchArchive: archive,
        realtimeClock: clock as unknown as RealtimeRuntimeClock,
        realtimeSchedulerTimer: timer,
        realtimeIds: {
          createRoomCode: () => "TANK2345",
          createReplayId: () => "tank-replay-" + ++replayId,
          createSetupRngSeed: () => "tank-setup",
          createRngSeed: () => "tank-map-v1.2-2",
          createPlayerSlotId: (i) => ("tank-slot-" + i) as never,
        },
        logger: { write: () => undefined },
      });
      const rooms: ClientRoom[] = [],
        inboxes: RoomMessagesV6[] = [];
      const ticket = (i: number) =>
        authority.issue("tank-user-" + i, { protocolVersion: 6 });
      try {
        const address = await app.start({ port: 0 });
        for (let i = 0; i < count; i++) {
          const client = new ColyseusClient(address.httpUrl);
          const room =
            i === 0
              ? await client.create(REALTIME_GAME_ROOM_NAME, {
                  type: "room.create",
                  protocolVersion: 6,
                  ticket: ticket(i),
                  gameId: "tank-maze",
                  initialConfig: {
                    playerCount: count,
                    targetScore: 5,
                    colors: [],
                  },
                })
              : await client.join(REALTIME_GAME_ROOM_NAME, {
                  type: "room.join",
                  protocolVersion: 6,
                  ticket: ticket(i),
                  roomCode: "TANK2345",
                });
          rooms.push(room);
          inboxes.push(messagesV6(room));
          await waitUntil(() => required(inboxes[i]).lifecycle.length > 0);
        }
        expect(required(inboxes[0]).lifecycle.at(-1)?.players).toHaveLength(8);
        expect(required(inboxes[0]).connected[0]).toMatchObject({
          gameVersion: "1.3.0",
        });
        if (count === 8)
          await expect(
            new ColyseusClient(address.httpUrl).join(REALTIME_GAME_ROOM_NAME, {
              type: "room.join",
              protocolVersion: 6,
              ticket: ticket(9),
              roomCode: "TANK2345",
            }),
          ).rejects.toThrow();
        for (let i = 0; i < count; i++)
          required(rooms[i]).send(ROOM_CONTROL_MESSAGE, {
            type: "room.control",
            protocolVersion: 6,
            commandId: "tank-ready-" + i,
            operation: "READY_FOR_ROUND",
          });
        await waitUntil(() => inboxes.every((i) => i.snapshots.length > 0));
        expect(archive.created[0]?.currentRound?.playerOrder).toHaveLength(
          count,
        );
        for (let n = 0; n < 180; n++) await timer.tick();
        await waitUntil(
          () => required(inboxes[0]).snapshots.at(-1)?.tick === 180,
        );
        const input = (id: string, sequence: number, data: unknown) => ({
          type: "realtime.input",
          realtimeProtocolVersion: 1,
          commandId: id,
          roundNumber: 1,
          inputSequence: sequence,
          input: data,
        });
        required(rooms[0]).send(
          REALTIME_INPUT_MESSAGE,
          input("forged", 1, { type: "FIRE", actor: "tank-slot-1" }),
        );
        await waitUntil(
          () => required(inboxes[0]).realtimeRejections.length === 1,
        );
        const fires = [
          input("fire-one", 1, { type: "FIRE" }),
          input("fire-two", 2, { type: "FIRE" }),
        ];
        for (const fire of fires)
          required(rooms[0]).send(REALTIME_INPUT_MESSAGE, fire);
        required(rooms[0]).send(REALTIME_INPUT_MESSAGE, required(fires[0]));
        required(rooms[0]).send(REALTIME_INPUT_MESSAGE, { barrier: true });
        await waitUntil(
          () => required(inboxes[0]).realtimeRejections.length >= 2,
        );
        await timer.tick();
        await waitUntil(
          () => required(inboxes[0]).snapshots.at(-1)?.tick === 181,
        );
        const record = await replayStore.get("tank-replay-1");
        expect(record?.header.gameVersion).toBe("1.3.0");
        expect(record?.events).toHaveLength(2);
        const projected = required(required(inboxes[0]).snapshots.at(-1))
          .view as {
          arena: { width: number; height: number };
          tanks: unknown[];
          bullets: unknown[];
        };
        expect(projected.arena).toMatchObject({
          width: 600000,
          height: 500000,
        });
        expect(projected.tanks).toHaveLength(count);
        expect(projected).not.toHaveProperty("nextId");
        expect(projected.bullets).toHaveLength(2);
        const takeover = await new ColyseusClient(address.httpUrl).join(
          REALTIME_GAME_ROOM_NAME,
          {
            type: "room.join",
            protocolVersion: 6,
            ticket: ticket(0),
            roomCode: "TANK2345",
          },
        );
        const resumed = messagesV6(takeover);
        rooms.push(takeover);
        await waitUntil(() => resumed.snapshots.length > 0);
        expect(resumed.connected[0]?.playerSlotId).toBe("tank-slot-0");
        expect(resumed.snapshots.at(-1)?.tick).toBe(181);
        for (let i = 1; i < count; i++) {
          required(rooms[i]).send(
            REALTIME_INPUT_MESSAGE,
            input("resign-" + i, 1, { type: "RESIGN" }),
          );
          required(rooms[i]).send(REALTIME_INPUT_MESSAGE, { barrier: true });
          await waitUntil(
            () => required(inboxes[i]).realtimeRejections.length > 0,
          );
        }
        await timer.tick();
        await waitUntil(
          () => resumed.lifecycle.at(-1)?.currentRound?.status === "completed",
        );
        const completed = await replayStore.get("tank-replay-1");
        expect(
          verifyRealtimeReplay(completed, resolveRealtimeGameDefinition).ok,
        ).toBe(true);
        expect(completed?.recordedOutcome).toMatchObject({
          winnerSlotId: "tank-slot-0",
        });
        for (let i = 1; i < count; i++)
          required(rooms[i]).send(ROOM_CONTROL_MESSAGE, {
            type: "room.control",
            protocolVersion: 6,
            commandId: "again-" + i,
            operation: "READY_FOR_ROUND",
          });
        takeover.send(ROOM_CONTROL_MESSAGE, {
          type: "room.control",
          protocolVersion: 6,
          commandId: "again-0",
          operation: "READY_FOR_ROUND",
        });
        await waitUntil(
          () => resumed.lifecycle.at(-1)?.currentRound?.roundNumber === 2,
        );
        expect(archive.created).toHaveLength(2);
        expect(
          (await replayStore.get("tank-replay-2"))?.header.gameVersion,
        ).toBe("1.3.0");
        expect(archive.created[1]?.currentRound?.playerOrder).toHaveLength(
          count,
        );
      } finally {
        await app.stop();
      }
    },
    20000,
  );
});
describe.sequential("Bomberman multiplayer Protocol V6", () => {
  const dropFixture = JSON.parse(
    readFileSync(
      new URL(
        "../../../games/bomberman/tests/fixtures/bomberman-1.2.0-drops.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    replay: RealtimeCanonicalReplay;
    dropCheckpoint: { tick: number; players: unknown[]; pickups: unknown[] };
  };
  it.each([2, 3, 4])(
    "runs %i real clients through three lives, authority checks, takeover and rematches",
    async (count) => {
      const clock = new FakeRuntimeClock(5000000);
      const timer = new ManualSchedulerTimer();
      const authority = new TestTicketAuthority({
        issuer: "bomberman-integration",
        secret: "bomberman-integration-secret",
        clock,
        lifetimeSeconds: 600,
      });
      const replayStore = new InMemoryRealtimeReplayStore();
      const roomStore = new InMemoryRealtimeRoomStore();
      const archive = new RecordingRealtimeArchive();
      let replaySerial = 0,
        seedSerial = 0;
      const app = createGameServer({
        ticketVerifier: authority,
        realtimeTicketVerifier: authority,
        realtimeReplayStore: replayStore,
        realtimeRoomStore: roomStore,
        realtimeMatchArchive: archive,
        realtimeClock: clock as unknown as RealtimeRuntimeClock,
        realtimeSchedulerTimer: timer,
        realtimeIds: {
          createRoomCode: () => "BMBR2345",
          createReplayId: () => `bomberman-replay-${++replaySerial}`,
          createSetupRngSeed: () => "bomberman-setup",
          createRngSeed: () => {
            seedSerial += 1;
            return seedSerial === 3
              ? dropFixture.replay.header.rng.seed
              : `bomberman-game-${seedSerial}`;
          },
          createPlayerSlotId: (i) => `bomberman-slot-${i}` as never,
        },
        logger: { write: () => undefined },
      });
      const clients: ClientRoom[] = [],
        inboxes: RoomMessagesV6[] = [];
      const ticket = (i: number) =>
        authority.issue(`bomberman-user-${i}`, { protocolVersion: 6 });
      const inbox = (i = 0) => required(inboxes[i]);
      const room = (i = 0) => required(clients[i]);
      interface View {
        selfSlotId: string;
        phase: string;
        startingLives: number;
        outcome: unknown;
        arena: { cols: number; rows: number; tiles: string[] };
        players: {
          slotId: string;
          index: number;
          alive: boolean;
          resigned: boolean;
          lives: number;
          invulnerableTicks: number;
          capacity: number;
          range: number;
          speed: number;
        }[];
        bombs: unknown[];
        pickups: unknown[];
      }
      const view = (i = 0) => required(inbox(i).snapshots.at(-1)).view as View;
      const setup = (
        commandId: string,
        revision: number,
        playerCount: number,
      ) => ({
        type: "game.setup",
        protocolVersion: 6,
        commandId,
        roundNumber: 1,
        expectedSetupRevision: revision,
        action: { type: "SET_PLAYER_COUNT", playerCount },
      });
      const barrier = async (i: number) => {
        const before = inbox(i).realtimeRejections.length;
        room(i).send(REALTIME_INPUT_MESSAGE, { deliveryBarrier: true });
        await waitUntil(() => inbox(i).realtimeRejections.length > before);
      };
      const advance = async (ticks: number) => {
        const target = (inbox().snapshots.at(-1)?.tick ?? 0) + ticks;
        for (let n = 0; n < ticks; n++) await timer.tick();
        await waitUntil(() =>
          inboxes.every((box) => box.snapshots.at(-1)?.tick === target),
        );
      };
      const nextInput = (i: number, data: unknown, roundNumber = 1) => {
        const sequence =
          (inbox(i).snapshots.at(-1)?.acknowledgedInputSequence ?? 0) + 1;
        return {
          ...input(`bomberman-${roundNumber}-${i}-${sequence}`, sequence, data),
          roundNumber,
        };
      };
      try {
        const address = await app.start({ port: 0 });
        for (let i = 0; i < count; i++) {
          const client = new ColyseusClient(address.httpUrl);
          const connected =
            i === 0
              ? await client.create(REALTIME_GAME_ROOM_NAME, {
                  type: "room.create",
                  protocolVersion: 6,
                  ticket: ticket(i),
                  gameId: "bomberman",
                  initialConfig: {
                    mapId: "classic-arena",
                    modeId: "classic",
                    playerCount: 2,
                  },
                })
              : await client.join(REALTIME_GAME_ROOM_NAME, {
                  type: "room.join",
                  protocolVersion: 6,
                  ticket: ticket(i),
                  roomCode: "BMBR2345",
                });
          clients.push(connected);
          inboxes.push(messagesV6(connected));
          await waitUntil(() => inbox(i).lifecycle.length > 0);
        }
        expect(inbox().connected[0]).toMatchObject({
          gameId: "bomberman",
          gameVersion: "1.2.0",
        });
        expect(inbox().lifecycle.at(-1)?.players).toHaveLength(4);
        expect(inbox().lifecycle.at(-1)?.nextRound?.setupView).toMatchObject({
          config: { playerCount: 2 },
        });
        expect(archive.created).toHaveLength(0);
        expect(await replayStore.get("bomberman-replay-1")).toBeNull();
        if (count === 4)
          await expect(
            new ColyseusClient(address.httpUrl).join(REALTIME_GAME_ROOM_NAME, {
              type: "room.join",
              protocolVersion: 6,
              ticket: ticket(9),
              roomCode: "BMBR2345",
            }),
          ).rejects.toThrow();

        room(1).send(GAME_SETUP_MESSAGE, setup("guest-setting", 0, 3));
        await waitUntil(() => inbox(1).rejections.length > 0);
        expect(inbox(1).rejections.at(-1)).toMatchObject({
          code: "SETUP_RULE_REJECTED",
          gameRuleCode: "NOT_OWNER",
        });
        for (const invalid of [1, 5, 2.5]) {
          const before = inbox().rejections.length;
          room().send(
            GAME_SETUP_MESSAGE,
            setup(`invalid-${invalid}`, 0, invalid),
          );
          await waitUntil(() => inbox().rejections.length > before);
          expect(inbox().lifecycle.at(-1)?.nextRound?.setupRevision).toBe(0);
        }
        let revision = 0;
        if (count !== 2) {
          room().send(
            GAME_SETUP_MESSAGE,
            setup("initial-count", revision++, count),
          );
          await waitUntil(
            () =>
              inbox().lifecycle.at(-1)?.nextRound?.setupRevision === revision,
          );
        }
        room().send(
          ROOM_CONTROL_MESSAGE,
          control("ready-before-edit", "READY_FOR_ROUND"),
        );
        await waitUntil(
          () =>
            inbox().lifecycle.at(-1)?.nextRound?.readiness.readySlotIds
              .length === 1,
        );
        const change = setup("change-count", revision, count === 4 ? 3 : 4);
        room().send(GAME_SETUP_MESSAGE, change);
        revision++;
        await waitUntil(
          () => inbox().lifecycle.at(-1)?.nextRound?.setupRevision === revision,
        );
        expect(inbox().lifecycle.at(-1)?.nextRound?.readiness).toMatchObject({
          canReady: false,
          readySlotIds: [],
        });
        room().send(
          GAME_SETUP_MESSAGE,
          setup("stale-count", revision - 1, count),
        );
        await waitUntil(
          () => inbox().rejections.at(-1)?.code === "STALE_SETUP_REVISION",
        );
        room().send(GAME_SETUP_MESSAGE, change);
        room().send(
          GAME_SETUP_MESSAGE,
          setup("restore-count", revision++, count),
        );
        await waitUntil(
          () => inbox().lifecycle.at(-1)?.nextRound?.setupRevision === revision,
        );
        for (let i = 0; i < count; i++)
          room(i).send(
            ROOM_CONTROL_MESSAGE,
            control(`ready-${i}`, "READY_FOR_ROUND"),
          );
        await waitUntil(() => inboxes.every((box) => box.snapshots.length > 0));
        expect(archive.created[0]?.currentRound?.playerOrder).toHaveLength(
          count,
        );

        const beforeInvalid = await roomStore.getByRoomCode("BMBR2345");
        for (const payload of [
          {
            ...input("forged-actor", 1, { type: "PLACE_BOMB" }),
            actorSlotId: "bomberman-slot-1",
            state: { lives: 3, invulnerableTicks: 999 },
            tick: 1000,
          },
          input("forged-coordinate", 1, {
            type: "MOVE",
            direction: "up",
            x: 0,
          }),
          input("invalid-direction", 1, {
            type: "MOVE",
            direction: "diagonal",
          }),
          input("forged-outcome", 1, {
            type: "RESIGN",
            winnerSlotId: "bomberman-slot-0",
          }),
        ]) {
          const before = inbox().realtimeRejections.length;
          room().send(REALTIME_INPUT_MESSAGE, payload);
          await waitUntil(() => inbox().realtimeRejections.length > before);
          expect(inbox().realtimeRejections.at(-1)?.code).toBe(
            "INVALID_INPUT_PAYLOAD",
          );
        }
        expect(await roomStore.getByRoomCode("BMBR2345")).toEqual(
          beforeInvalid,
        );
        expect((await replayStore.get("bomberman-replay-1"))?.events).toEqual(
          [],
        );
        await advance(180);
        expect(view().phase).toBe("ACTIVE");
        const burst = [
          { type: "MOVE", direction: "right" },
          { type: "MOVE", direction: "left" },
          { type: "PLACE_BOMB" },
          { type: "PLACE_BOMB" },
          { type: "MOVE", direction: "none" },
        ].map((value, index) => input(`ordered-${index}`, index + 1, value));
        for (const command of burst)
          room().send(REALTIME_INPUT_MESSAGE, command);
        room().send(REALTIME_INPUT_MESSAGE, required(burst[3]));
        await barrier(0);
        for (let i = 1; i < count - 1; i++) {
          room(i).send(
            REALTIME_INPUT_MESSAGE,
            nextInput(i, { type: "PLACE_BOMB" }),
          );
          await barrier(i);
        }
        await advance(1);
        const activeRecord = required(
          await replayStore.get("bomberman-replay-1"),
        );
        expect(
          activeRecord.events
            .filter((event) => event.actorSlotId === "bomberman-slot-0")
            .map((event) => event.input),
        ).toEqual(burst.map((command) => command.input));
        expect(activeRecord.events).toHaveLength(5 + count - 2);
        expect(view().bombs).toHaveLength(count - 1);
        expect(inbox().snapshots.at(-1)?.acknowledgedInputSequence).toBe(5);
        for (let i = 0; i < count; i++) {
          expect(view(i).selfSlotId).toBe(`bomberman-slot-${i}`);
          expect(view(i).arena).toMatchObject({ cols: 13, rows: 11 });
          expect(view(i).players).toHaveLength(count);
          const serialized = JSON.stringify(view(i));
          for (const secret of [
            "hiddenPickups",
            "pendingPickups",
            "lease",
            "rng",
            "passThrough",
            "seed",
          ])
            expect(serialized).not.toContain(`"${secret}"`);
          expect(view(i).players.map((player) => player.index)).toEqual(
            Array.from({ length: count }, (_, n) => n),
          );
        }
        for (const [clientIndex, command, code] of [
          [1, required(burst[0]), "DUPLICATE_COMMAND"],
          [
            0,
            input("stale-sequence", 5, { type: "PLACE_BOMB" }),
            "STALE_INPUT_SEQUENCE",
          ],
          [
            0,
            { ...input("wrong-round", 6, { type: "RESIGN" }), roundNumber: 2 },
            "ROUND_MISMATCH",
          ],
        ] as const) {
          room(clientIndex).send(REALTIME_INPUT_MESSAGE, command);
          await waitUntil(
            () => inbox(clientIndex).realtimeRejections.at(-1)?.code === code,
          );
        }
        expect((await replayStore.get("bomberman-replay-1"))?.events).toEqual(
          activeRecord.events,
        );
        await advance(150);
        expect(view().phase).toBe("ACTIVE");
        expect(view().players.map((player) => player.alive)).toEqual(
          Array.from({ length: count }, () => true),
        );
        expect(view().players.map((player) => player.lives)).toEqual(
          Array.from({ length: count }, (_, i) => (i === count - 1 ? 3 : 2)),
        );
        expect(view().players[0]?.invulnerableTicks).toBe(120);

        const resumed = await new ColyseusClient(address.httpUrl).join(
          REALTIME_GAME_ROOM_NAME,
          {
            type: "room.join",
            protocolVersion: 6,
            ticket: ticket(0),
            roomCode: "BMBR2345",
          },
        );
        clients[0] = resumed;
        inboxes[0] = messagesV6(resumed);
        await waitUntil(() => inbox().snapshots.length > 0);
        expect(inbox().connected[0]?.playerSlotId).toBe("bomberman-slot-0");
        expect(inbox().snapshots.at(-1)?.tick).toBe(331);
        expect(view().players[0]).toMatchObject({
          lives: 2,
          invulnerableTicks: 120,
        });
        for (let hit = 2; hit <= 3; hit++) {
          await advance(30);
          expect(view()).toMatchObject({ phase: "ACTIVE", startingLives: 3 });
          for (const player of view().players)
            expect(player).toMatchObject({
              alive: true,
              capacity: 2,
              range: 1,
              speed: 4,
            });
          for (let i = 0; i < count - 1; i++) {
            room(i).send(
              REALTIME_INPUT_MESSAGE,
              nextInput(i, { type: "PLACE_BOMB" }),
            );
            await barrier(i);
          }
          await advance(151);
          expect(view().players.at(-1)?.lives).toBe(3);
          expect(view().players[0]?.lives).toBe(3 - hit);
        }
        await waitUntil(() =>
          inboxes.every(
            (box) => box.lifecycle.at(-1)?.currentRound?.status === "completed",
          ),
        );
        const completed = required(await replayStore.get("bomberman-replay-1"));
        expect(completed.finalTick).toBe(693);
        expect(completed.recordedOutcome).toMatchObject({
          type: "WIN",
          reason: "SURVIVOR",
          winnerSlotId: `bomberman-slot-${count - 1}`,
        });
        expect(
          verifyRealtimeReplay(completed, resolveRealtimeGameDefinition).ok,
        ).toBe(true);
        room().send(
          REALTIME_INPUT_MESSAGE,
          nextInput(0, { type: "PLACE_BOMB" }),
        );
        await barrier(0);
        expect(await replayStore.get("bomberman-replay-1")).toEqual(completed);
        for (let i = 0; i < count - 1; i++)
          room(i).send(
            ROOM_CONTROL_MESSAGE,
            control(`again-${i}`, "READY_FOR_ROUND"),
          );
        await waitUntil(
          () =>
            inbox().lifecycle.at(-1)?.nextRound?.readiness.readySlotIds
              .length ===
            count - 1,
        );
        expect(inbox().lifecycle.at(-1)?.currentRound?.roundNumber).toBe(1);
        room(count - 1).send(
          ROOM_CONTROL_MESSAGE,
          control("again-last", "READY_FOR_ROUND"),
        );
        await waitUntil(() =>
          inboxes.every((box) => box.snapshots.at(-1)?.roundNumber === 2),
        );
        expect(inbox().snapshots.at(-1)?.tick).toBe(0);
        const nextRecord = required(
          await replayStore.get("bomberman-replay-2"),
        );
        expect(nextRecord.header.initialConfig).toEqual(
          completed.header.initialConfig,
        );
        expect(nextRecord.header.players).toEqual(completed.header.players);
        expect(nextRecord.header.rng.seed).not.toBe(completed.header.rng.seed);
        expect(nextRecord.events).toEqual([]);
        for (let i = 0; i < count - 1; i++) {
          room(i).send(
            REALTIME_INPUT_MESSAGE,
            nextInput(i, { type: "RESIGN" }, 2),
          );
          await barrier(i);
        }
        await advance(1);
        expect(view().outcome).toMatchObject({
          type: "WIN",
          reason: "RESIGNATION",
          winnerSlotId: `bomberman-slot-${count - 1}`,
        });
        expect(
          verifyRealtimeReplay(
            await replayStore.get("bomberman-replay-2"),
            resolveRealtimeGameDefinition,
          ).ok,
        ).toBe(true);
        expect(archive.created).toHaveLength(2);
        if (count === 2) {
          for (let i = 0; i < count; i++)
            room(i).send(
              ROOM_CONTROL_MESSAGE,
              control(`drop-ready-${i}`, "READY_FOR_ROUND"),
            );
          await waitUntil(() =>
            inboxes.every((box) => box.snapshots.at(-1)?.roundNumber === 3),
          );
          const milestones = [
            ...new Set([
              ...dropFixture.replay.events.map((event) => event.tick),
              dropFixture.dropCheckpoint.tick,
              dropFixture.replay.finalTick,
            ]),
          ].sort((a, b) => a - b);
          for (const tick of milestones) {
            const now = inbox().snapshots.at(-1)?.tick ?? 0;
            if (tick > now) await advance(tick - now);
            if (tick === dropFixture.dropCheckpoint.tick) {
              for (let i = 0; i < count; i++) {
                expect(view(i).players).toMatchObject(
                  dropFixture.dropCheckpoint.players,
                );
                expect(view(i).pickups).toEqual(
                  dropFixture.dropCheckpoint.pickups,
                );
              }
              const restored = await new ColyseusClient(address.httpUrl).join(
                REALTIME_GAME_ROOM_NAME,
                {
                  type: "room.join",
                  protocolVersion: 6,
                  ticket: ticket(0),
                  roomCode: "BMBR2345",
                },
              );
              clients[0] = restored;
              inboxes[0] = messagesV6(restored);
              await waitUntil(() => inbox().snapshots.length > 0);
              expect(view().pickups).toEqual(
                dropFixture.dropCheckpoint.pickups,
              );
              expect(view().players).toMatchObject(
                dropFixture.dropCheckpoint.players,
              );
            }
            clock.advanceBy(1000);
            for (const event of dropFixture.replay.events.filter(
              (entry) => entry.tick === tick,
            )) {
              const actor = Number(event.actorSlotId.slice(1));
              room(actor).send(
                REALTIME_INPUT_MESSAGE,
                nextInput(actor, event.input, 3),
              );
              await barrier(actor);
            }
          }
          const dropped = required(await replayStore.get("bomberman-replay-3"));
          expect(
            dropped.events.map(({ tick, input }) => ({ tick, input })),
          ).toEqual(
            dropFixture.replay.events.map(({ tick, input }) => ({
              tick,
              input,
            })),
          );
          expect(dropped.recordedRngCursor).toBe(
            dropFixture.replay.recordedRngCursor,
          );
          expect(
            verifyRealtimeReplay(dropped, resolveRealtimeGameDefinition).ok,
          ).toBe(true);
          expect(archive.created).toHaveLength(3);
        }
        room().send(
          ROOM_CONTROL_MESSAGE,
          control("close-bomberman", "CLOSE_ROOM"),
        );
        await waitUntil(
          async () =>
            (await roomStore.getByRoomCode("BMBR2345"))?.closeReason != null,
        );
      } finally {
        await app.stop();
      }
    },
    30000,
  );
});
describe.sequential("realtime badminton Protocol V6", () => {
  const clock = new FakeRuntimeClock(3000000);
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
      athletes: [
        {
          x: number;
          y: number;
        },
        {
          x: number;
          y: number;
        },
      ];
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
      gameVersion: "1.4.0",
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
        tick: 10000,
      },
      input("forged-position", 1, {
        type: "CONTROL",
        move: 1,
        jump: false,
        serve: false,
        shot: "CLEAR",
        x: 900000,
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
          (
            resumed.snapshots.at(-1)?.view as {
              phase: string;
            }
          ).phase === "RALLY",
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
      for (let tick = 0; tick < 210; tick++) await schedulerTimer.tick();
      await waitUntil(
        () =>
          resumed.snapshots.at(-1)?.outcome !== null ||
          (resumed.snapshots.at(-1)?.tick ?? 0) >= initialTick + 210,
      );
    }
    await waitUntil(
      () => resumed.lifecycle.at(-1)?.currentRound?.status === "completed",
    );
    const scoredReplay = await replayStore.get("badminton-replay-2");
    expect(scoredReplay?.header.gameVersion).toBe("1.4.0");
    expect(scoredReplay?.recordedOutcome).toEqual({
      type: "WIN",
      reason: "SCORE",
      winnerSlotId: "badminton-slot-2",
      scores: [7, 0],
    });
    expect(
      scoredReplay?.events.filter(
        (event) =>
          (
            event.input as {
              serve?: boolean;
            }
          ).serve && event.actorSlotId === "badminton-slot-2",
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
  }, 30000);
});

describe("realtime air hockey Protocol V6", () => {
  it("enforces serving and input authority, preserves slots and settings, and rebuilds both completed rounds", async () => {
    const clock = new FakeRuntimeClock(4000000);
    const scheduler = new ManualSchedulerTimer();
    const authority = new TestTicketAuthority({
      issuer: "hockey-integration",
      secret: "hockey-integration-secret",
      clock,
      lifetimeSeconds: 600,
    });
    const replayStore = new InMemoryRealtimeReplayStore();
    const roomStore = new InMemoryRealtimeRoomStore();
    const archive = new RecordingRealtimeArchive();
    let replayId = 0,
      seed = 0,
      setupSeed = 0;
    const app = createGameServer({
      ticketVerifier: authority,
      realtimeTicketVerifier: authority,
      realtimeReplayStore: replayStore,
      realtimeRoomStore: roomStore,
      realtimeMatchArchive: archive,
      realtimeClock: clock as unknown as RealtimeRuntimeClock,
      realtimeSchedulerTimer: scheduler,
      realtimeIds: {
        createRoomCode: () => "AHCK2345",
        createReplayId: () => `hockey-replay-${++replayId}`,
        createRngSeed: () => `hockey-seed-${++seed}`,
        createSetupRngSeed: () => `hockey-setup-${++setupSeed}`,
        createPlayerSlotId: (index) => `hockey-p${index + 1}` as never,
      },
      logger: { write: () => undefined },
    });
    const rooms: ClientRoom[] = [];
    type HockeyView = {
      tick: number;
      rally: number;
      phase: string;
      server: 0 | 1;
      scores: [number, number];
      puck: { x: number; y: number };
      paddles: { x: number; y: number }[];
      events: { kind: string }[];
      outcome: unknown | null;
    };
    const view = (inbox: RoomMessagesV6) =>
      inbox.snapshots.at(-1)?.view as HockeyView;
    async function barrier(room: ClientRoom, inbox: RoomMessagesV6) {
      const count = inbox.realtimeRejections.length;
      room.send(REALTIME_INPUT_MESSAGE, { barrier: true });
      await waitUntil(() => inbox.realtimeRejections.length > count);
    }
    async function advance(inbox: RoomMessagesV6, count: number) {
      const target = (inbox.snapshots.at(-1)?.tick ?? 0) + count;
      for (let i = 0; i < count; i++) await scheduler.tick();
      await waitUntil(
        () =>
          (inbox.snapshots.at(-1)?.tick ?? 0) >= target ||
          view(inbox).outcome !== null,
      );
    }
    const setup = (
      commandId: string,
      revision: number,
      targetScore: number,
    ) => ({
      type: "game.setup",
      protocolVersion: 6,
      commandId,
      roundNumber: 1,
      expectedSetupRevision: revision,
      action: { type: "SET_TARGET_SCORE", targetScore },
    });
    const ticket = (session: string) =>
      authority.issue(session, { protocolVersion: 6 });
    try {
      const address = await app.start({ port: 0 });
      const roomA = await new ColyseusClient(address.httpUrl).create(
        REALTIME_GAME_ROOM_NAME,
        {
          type: "room.create",
          protocolVersion: 6,
          ticket: ticket("hockey-a"),
          gameId: "air-hockey",
          initialConfig: { targetScore: 7 },
        },
      );
      rooms.push(roomA);
      const inboxA = messagesV6(roomA);
      await waitUntil(() => inboxA.lifecycle.length > 0);
      const roomB = await new ColyseusClient(address.httpUrl).join(
        REALTIME_GAME_ROOM_NAME,
        {
          type: "room.join",
          protocolVersion: 6,
          ticket: ticket("hockey-b"),
          roomCode: "AHCK2345",
        },
      );
      rooms.push(roomB);
      const inboxB = messagesV6(roomB);
      await waitUntil(() => inboxB.lifecycle.length > 0);
      expect(await replayStore.get("hockey-replay-1")).toBeNull();
      expect(inboxB.lifecycle.at(-1)?.nextRound?.setupView).toMatchObject({
        config: { targetScore: 7 },
        canEdit: false,
        ownerSlotId: "hockey-p1",
      });
      roomB.send(GAME_SETUP_MESSAGE, setup("guest-setting", 0, 5));
      await waitUntil(() => inboxB.rejections.length > 0);
      expect(inboxB.rejections.at(-1)).toMatchObject({
        code: "SETUP_RULE_REJECTED",
        gameRuleCode: "NOT_OWNER",
      });
      roomA.send(
        ROOM_CONTROL_MESSAGE,
        control("ready-before-setting", "READY_FOR_ROUND"),
      );
      await waitUntil(
        () => inboxA.lifecycle.at(-1)?.nextRound?.readiness.selfReady === true,
      );
      roomA.send(GAME_SETUP_MESSAGE, setup("eleven-points", 0, 11));
      await waitUntil(
        () => inboxA.lifecycle.at(-1)?.nextRound?.setupRevision === 1,
      );
      expect(
        inboxA.lifecycle.at(-1)?.nextRound?.readiness.readySlotIds,
      ).toEqual([]);
      roomA.send(GAME_SETUP_MESSAGE, setup("stale-setting", 0, 5));
      await waitUntil(
        () => inboxA.rejections.at(-1)?.code === "STALE_SETUP_REVISION",
      );
      roomA.send(GAME_SETUP_MESSAGE, setup("five-points", 1, 5));
      await waitUntil(
        () => inboxA.lifecycle.at(-1)?.nextRound?.setupRevision === 2,
      );
      roomA.send(ROOM_CONTROL_MESSAGE, control("ready-a", "READY_FOR_ROUND"));
      roomB.send(ROOM_CONTROL_MESSAGE, control("ready-b", "READY_FOR_ROUND"));
      await waitUntil(
        () => inboxA.snapshots.length > 0 && inboxB.snapshots.length > 0,
      );
      expect(inboxA.snapshots.at(-1)?.view).toMatchObject({
        yourSide: 0,
        server: 0,
        phase: "SERVE",
        targetScore: 5,
        scores: [0, 0],
        players: [
          { slotId: "hockey-p1", color: "BLUE" },
          { slotId: "hockey-p2", color: "ORANGE" },
        ],
      });
      expect(inboxB.snapshots.at(-1)?.view).toMatchObject({ yourSide: 1 });
      expect(JSON.stringify(view(inboxA))).not.toMatch(
        /velocity|inputAge|target"|seed|session|ticket/iu,
      );
      for (const payload of [
        {
          ...input("forged-actor", 1, { type: "RESIGN" }),
          actorSlotId: "hockey-p2",
        },
        input("forged-position", 1, {
          type: "CONTROL",
          target: { x: 5000, y: 5000 },
          x: 1,
          velocityX: 2,
        }),
        input("invalid-target", 1, {
          type: "CONTROL",
          target: { x: 0.5, y: 10001 },
        }),
        input("forged-score", 1, { type: "RESIGN", scores: [5, 0] }),
      ]) {
        const rejected = inboxA.realtimeRejections.length;
        roomA.send(REALTIME_INPUT_MESSAGE, payload);
        await waitUntil(() => inboxA.realtimeRejections.length > rejected);
        expect(inboxA.realtimeRejections.at(-1)?.code).toBe(
          "INVALID_INPUT_PAYLOAD",
        );
      }
      expect(inboxA.snapshots.at(-1)?.tick).toBe(0);
      expect((await replayStore.get("hockey-replay-1"))?.events).toHaveLength(
        0,
      );
      const movement = input("move-a", 1, {
        type: "CONTROL",
        target: { x: 6500, y: 7500 },
      });
      roomA.send(REALTIME_INPUT_MESSAGE, movement);
      roomA.send(REALTIME_INPUT_MESSAGE, movement);
      await barrier(roomA, inboxA);
      await advance(inboxA, 1);
      expect(view(inboxA).paddles[0]?.x).toBe(330000);
      expect((await replayStore.get("hockey-replay-1"))?.events).toHaveLength(
        1,
      );
      roomB.send(REALTIME_INPUT_MESSAGE, movement);
      await waitUntil(
        () => inboxB.realtimeRejections.at(-1)?.code === "DUPLICATE_COMMAND",
      );
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
      expect((await replayStore.get("hockey-replay-1"))?.events).toHaveLength(
        1,
      );
      roomB.send(
        REALTIME_INPUT_MESSAGE,
        input("non-server-touch", 1, {
          type: "CONTROL",
          target: { x: 5000, y: 5000 },
        }),
      );
      await barrier(roomB, inboxB);
      await advance(inboxA, 35);
      expect(view(inboxA)).toMatchObject({
        phase: "SERVE",
        puck: { x: 300000, y: 510000 },
        scores: [0, 0],
        events: [],
      });
      const takeover = await new ColyseusClient(address.httpUrl).join(
        REALTIME_GAME_ROOM_NAME,
        {
          type: "room.join",
          protocolVersion: 6,
          ticket: ticket("hockey-a"),
          roomCode: "AHCK2345",
        },
      );
      rooms.push(takeover);
      const resumed = messagesV6(takeover);
      await waitUntil(() => resumed.snapshots.length > 0);
      expect(resumed.connected[0]?.playerSlotId).toBe("hockey-p1");
      expect(view(resumed)).toEqual(view(inboxA));
      const sequences: [number, number] = [1, 1];
      let serial = 0;
      // Move both paddles away before the first serve; each later reset starts
      // from the Core's home positions. Inputs travel through real WebSockets.
      for (const [side, room, inbox] of [
        [0, takeover, resumed],
        [1, roomB, inboxB],
      ] as const) {
        room.send(
          REALTIME_INPUT_MESSAGE,
          input(`park-${side}`, ++sequences[side], {
            type: "CONTROL",
            target: { x: side === 0 ? 5000 : 700, y: 7500 },
          }),
        );
        await barrier(room, inbox);
      }
      await advance(resumed, 25);
      for (
        let point = 0;
        point < 9 && view(resumed).outcome === null;
        point++
      ) {
        const before = view(resumed);
        for (const [side, room, inbox] of [
          [0, takeover, resumed],
          [1, roomB, inboxB],
        ] as const) {
          room.send(
            REALTIME_INPUT_MESSAGE,
            input(`rally-${++serial}`, ++sequences[side], {
              type: "CONTROL",
              target:
                side === before.server
                  ? { x: 5000, y: 5000 }
                  : { x: 700, y: 7500 },
            }),
          );
          await barrier(room, inbox);
        }
        for (
          let batch = 0;
          batch < 30 &&
          view(resumed).rally === before.rally &&
          view(resumed).outcome === null;
          batch++
        )
          await advance(resumed, 12);
        expect(view(resumed).scores[0] + view(resumed).scores[1]).toBe(
          before.scores[0] + before.scores[1] + 1,
        );
      }
      expect(Math.max(...view(resumed).scores)).toBe(5);
      await waitUntil(
        () => resumed.lifecycle.at(-1)?.currentRound?.status === "completed",
      );
      const firstReplay = await replayStore.get("hockey-replay-1");
      expect(firstReplay?.header.gameVersion).toBe("1.1.0");
      expect(firstReplay?.recordedOutcome).toMatchObject({
        reason: "SCORE",
        scores: view(resumed).scores,
      });
      expect(firstReplay?.recordedRngCursor).toBe(0);
      expect(
        verifyRealtimeReplay(firstReplay, resolveRealtimeGameDefinition),
      ).toMatchObject({ ok: true });
      expect(firstReplay?.header.initialConfig).toEqual({ targetScore: 5 });
      takeover.send(
        ROOM_CONTROL_MESSAGE,
        control("again-a", "READY_FOR_ROUND"),
      );
      await waitUntil(
        () => resumed.lifecycle.at(-1)?.nextRound?.readiness.selfReady === true,
      );
      expect(resumed.snapshots.at(-1)?.roundNumber).toBe(1);
      roomB.send(ROOM_CONTROL_MESSAGE, control("again-b", "READY_FOR_ROUND"));
      await waitUntil(() => resumed.snapshots.at(-1)?.roundNumber === 2);
      expect(view(resumed)).toMatchObject({
        tick: 0,
        phase: "SERVE",
        server: 0,
        scores: [0, 0],
        targetScore: 5,
        yourSide: 0,
      });
      roomB.send(REALTIME_INPUT_MESSAGE, {
        ...input("second-round-resign", 1, { type: "RESIGN" }),
        roundNumber: 2,
      });
      await barrier(roomB, inboxB);
      await advance(resumed, 1);
      const secondReplay = await replayStore.get("hockey-replay-2");
      expect(secondReplay?.recordedOutcome).toMatchObject({
        reason: "RESIGNATION",
        winnerSlotId: "hockey-p1",
        resignedSlotId: "hockey-p2",
        scores: [0, 0],
      });
      expect(secondReplay?.header.rng.seed).not.toBe(
        firstReplay?.header.rng.seed,
      );
      expect(
        verifyRealtimeReplay(secondReplay, resolveRealtimeGameDefinition),
      ).toMatchObject({ ok: true });
      expect(archive.created).toHaveLength(2);
    } finally {
      await Promise.allSettled(
        rooms
          .filter((room) => room.connection.isOpen)
          .map((room) => room.leave(true)),
      );
      await app.stop();
    }
  }, 30000);
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required tank value is missing.");
  return value;
}
