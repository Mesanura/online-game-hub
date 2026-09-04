import { describe, expect, it } from "vitest";

import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";
import type { RealtimeGameDefinition } from "@online-game-hub/realtime-game-sdk";
import { z } from "zod";

import {
  InMemoryRealtimeReplayStore,
  RealtimeRound,
  RealtimeTickScheduler,
} from "../src/index.js";

type State = {
  readonly players: readonly [string, string];
  readonly tick: number;
  readonly values: readonly [number, number];
  readonly done: boolean;
};
type Input = { readonly direction: -1 | 0 | 1 };
type View = {
  readonly tick: number;
  readonly values: readonly [number, number];
};
type Outcome = { readonly type: "DONE" };

const left = defineRealtimePlayerSlotId("left");
const right = defineRealtimePlayerSlotId("right");
const definition: RealtimeGameDefinition<null, State, Input, View, Outcome> = {
  manifest: {
    runtime: "realtime",
    id: "runtime-test" as never,
    gameVersion: "1.0.0" as never,
    title: "test",
    description: "test",
    defaultConfig: null,
    minPlayers: 2,
    maxPlayers: 2,
    tickRate: 60,
    capabilities: { hiddenInformation: false, deterministicRandomness: true },
  },
  configSchema: z.null(),
  inputSchema: z
    .object({ direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]) })
    .strict(),
  createInitialState: ({ players, rng }) => {
    const [firstPlayer, secondPlayer] = players;
    if (firstPlayer === undefined || secondPlayer === undefined) {
      throw new Error("Runtime test requires two players.");
    }
    return {
      state: {
        players: [firstPlayer, secondPlayer],
        tick: 0,
        values: [0, 0],
        done: false,
      },
      rng,
    };
  },
  step: ({ state, tick, inputs, rng }) => {
    if (tick !== state.tick) throw new Error("bad tick");
    const values: [number, number] = [...state.values];
    for (const input of inputs) {
      const index = state.players.indexOf(input.slotId);
      if (index !== 0 && index !== 1) throw new Error("unknown player");
      values[index] += input.input.direction;
    }
    return {
      state: { ...state, tick: tick + 1, values, done: values[0] === 2 },
      rng,
    };
  },
  projectView: ({ state }) => ({ tick: state.tick, values: state.values }),
  getOutcome: (state) => (state.done ? { type: "DONE" } : null),
};

function command(
  commandId: string,
  inputSequence: number,
  direction: -1 | 0 | 1,
) {
  return {
    type: "realtime.input",
    realtimeProtocolVersion: 1,
    commandId,
    roundNumber: 1,
    inputSequence,
    input: { direction },
  };
}

async function setup() {
  const store = new InMemoryRealtimeReplayStore();
  const round = await RealtimeRound.create({
    definition,
    config: null,
    players: [left, right],
    rng: createRealtimeRng("runtime-seed"),
    roundNumber: 1,
    replayId: "replay",
    replayStore: store,
  });
  return { round, store };
}

describe("fixed-tick realtime round", () => {
  it("assigns the next effective tick and orders simultaneous input by slot", async () => {
    const { round, store } = await setup();
    await expect(
      round.receiveInput(right, command("right-1", 1, -1)),
    ).resolves.toMatchObject({ accepted: true, effectiveTick: 1 });
    await expect(
      round.receiveInput(left, command("left-1", 1, 1)),
    ).resolves.toMatchObject({ accepted: true, effectiveTick: 1 });
    const snapshots = await round.advanceTick();
    expect(
      snapshots.map((snapshot) => snapshot.acknowledgedInputSequence),
    ).toEqual([1, 1]);
    expect(snapshots[0]).toMatchObject({ tick: 1, view: { values: [1, -1] } });
    expect((await store.get("replay"))?.events).toEqual([
      { sequence: 1, tick: 0, actorSlotId: "left", input: { direction: 1 } },
      { sequence: 2, tick: 0, actorSlotId: "right", input: { direction: -1 } },
    ]);
  });

  it("rejects malformed, stale sequence, wrong round and forged fields", async () => {
    const { round, store } = await setup();
    const unknownSlot = defineRealtimePlayerSlotId("unknown");
    expect(
      await round.receiveInput(unknownSlot, command("unknown", 1, 1)),
    ).toMatchObject({
      accepted: false,
      rejection: { code: "NOT_A_PLAYER" },
    });
    expect(
      await round.receiveInput(left, { ...command("forged", 1, 1), tick: 50 }),
    ).toMatchObject({
      accepted: false,
      rejection: { code: "INVALID_INPUT_PAYLOAD" },
    });
    expect(
      await round.receiveInput(left, {
        ...command("wrong-round", 1, 1),
        roundNumber: 2,
      }),
    ).toMatchObject({ accepted: false, rejection: { code: "ROUND_MISMATCH" } });
    expect(
      await round.receiveInput(left, command("first", 2, 1)),
    ).toMatchObject({ accepted: true });
    expect(
      await round.receiveInput(left, command("stale", 1, -1)),
    ).toMatchObject({
      accepted: false,
      rejection: { code: "STALE_INPUT_SEQUENCE" },
    });
    expect((await store.get("replay"))?.events).toEqual([]);
    expect(round.tick).toBe(0);
  });

  it("keeps accepted input queued until its assigned tick and acknowledges only applied input", async () => {
    const { round, store } = await setup();
    const accepted = await round.receiveInput(left, command("queued", 1, 1));
    expect(accepted).toMatchObject({ accepted: true, effectiveTick: 1 });
    expect((await store.get("replay"))?.events).toEqual([]);
    expect(round.tick).toBe(0);
    const snapshots = await round.advanceTick();
    expect(round.tick).toBe(1);
    expect(snapshots[0]?.acknowledgedInputSequence).toBe(1);
    expect((await store.get("replay"))?.events[0]).toEqual({
      sequence: 1,
      tick: 0,
      actorSlotId: "left",
      input: { direction: 1 },
    });
  });

  it("is command-idempotent and completes the replay exactly once", async () => {
    const { round, store } = await setup();
    const first = await round.receiveInput(left, command("same", 1, 1));
    expect(await round.receiveInput(left, command("same", 99, -1))).toEqual(
      first,
    );
    await round.advanceTick();
    await round.receiveInput(left, command("second", 2, 1));
    const terminal = await round.advanceTick();
    expect(terminal[0]).toMatchObject({ tick: 2, outcome: { type: "DONE" } });
    const replay = await store.get("replay");
    expect(replay).toMatchObject({
      finalTick: 2,
      recordedRngCursor: 0,
      recordedOutcome: { type: "DONE" },
    });
    expect(replay?.events).toHaveLength(2);
    expect(
      await round.receiveInput(left, command("terminal", 3, 0)),
    ).toMatchObject({
      accepted: false,
      rejection: { code: "MATCH_NOT_ACTIVE" },
    });
  });
});

describe("in-memory realtime replay store", () => {
  it("enforces idempotency, sequence, tick and completion conflicts", async () => {
    const store = new InMemoryRealtimeReplayStore();
    const header = {
      replayFormatVersion: 1 as const,
      runtime: "realtime" as const,
      gameId: "test",
      gameVersion: "1.0.0",
      tickRate: 60 as const,
      rng: { algorithm: "fnv1a32-counter-v1", seed: "seed" },
      initialConfig: null,
      players: [{ slotId: "left" }, { slotId: "right" }],
    };
    await store.create("id", header);
    await store.create("id", header);
    const first = {
      sequence: 1,
      tick: 0,
      actorSlotId: "left",
      input: { direction: 1 },
    };
    await store.append("id", 0, first);
    await store.append("id", 0, first);
    await expect(
      store.append("id", 2, { ...first, sequence: 3 }),
    ).rejects.toThrow("contiguous");
    await expect(
      store.append("id", 1, { ...first, sequence: 2, tick: -1 }),
    ).rejects.toThrow("backwards");
    await store.complete("id", 1, 1, 0, { type: "DONE" });
    await store.complete("id", 1, 1, 0, { type: "DONE" });
    await expect(
      store.complete("id", 1, 2, 0, { type: "DONE" }),
    ).rejects.toThrow("conflict");
  });
});

it("serializes scheduler callbacks at 60 Hz", async () => {
  let callback: (() => void) | undefined;
  const timer = {
    setInterval(next: () => void, milliseconds: number) {
      expect(milliseconds).toBeCloseTo(1000 / 60);
      callback = next;
      return 1;
    },
    clearInterval(handle: unknown) {
      expect(handle).toBe(1);
    },
  };
  const calls: number[] = [];
  const scheduler = new RealtimeTickScheduler({
    timer,
    async onTick() {
      calls.push(calls.length + 1);
    },
  });
  scheduler.start();
  callback?.();
  callback?.();
  await scheduler.stop();
  expect(calls).toEqual([1, 2]);
});
