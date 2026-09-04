import { describe, expect, it } from "vitest";

import {
  REALTIME_RNG_ALGORITHM_V1,
  defineRealtimeGameId,
  defineRealtimeGameVersion,
  eraseRealtimeGameDefinition,
  reconstructRealtimeReplayFrames,
  verifyRealtimeReplay,
} from "../src/index.js";
import type {
  RealtimeGameDefinition,
  RealtimePlayerSlotId,
} from "../src/index.js";
import { z } from "zod";

type TestState = {
  readonly players: readonly RealtimePlayerSlotId[];
  readonly value: number;
};
type TestInput = { readonly direction: -1 | 0 | 1 };

const definition: RealtimeGameDefinition<
  null,
  TestState,
  TestInput,
  TestState,
  { readonly type: "DONE" }
> = {
  manifest: {
    runtime: "realtime",
    id: defineRealtimeGameId("test-realtime"),
    gameVersion: defineRealtimeGameVersion("1.0.0"),
    title: "test",
    description: "test",
    defaultConfig: null,
    minPlayers: 2,
    maxPlayers: 2,
    tickRate: 60,
    capabilities: {
      hiddenInformation: false,
      deterministicRandomness: true,
      replay: "player-playback",
    },
  },
  configSchema: z.null(),
  inputSchema: z
    .object({ direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]) })
    .strict(),
  createInitialState: ({ players, rng }) => ({
    state: { players, value: 0 },
    rng,
  }),
  step: ({ state, inputs, rng }) => ({
    state: {
      players: state.players,
      value: state.value + (inputs[0]?.input.direction ?? 0),
    },
    rng,
  }),
  projectView: ({ state }) => state,
  getOutcome: (state) => (state.value >= 1 ? { type: "DONE" } : null),
};

const resolver = () => eraseRealtimeGameDefinition(definition);

describe("realtime replay verifier", () => {
  it("reconstructs accepted tick events", () => {
    const replay = {
      header: {
        replayFormatVersion: 1,
        runtime: "realtime",
        gameId: "test-realtime",
        gameVersion: "1.0.0",
        tickRate: 60,
        rng: { algorithm: REALTIME_RNG_ALGORITHM_V1, seed: "seed" },
        initialConfig: null,
        players: [{ slotId: "a" }, { slotId: "b" }],
      },
      events: [
        { sequence: 1, tick: 0, actorSlotId: "a", input: { direction: 1 } },
      ],
      recordedRngCursor: null,
      recordedOutcome: null,
      finalTick: 1,
    };
    const result = verifyRealtimeReplay(replay, resolver);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.state).toMatchObject({ value: 1 });
    }
  });

  it("rejects gaps, backward ticks and forged actors", () => {
    const base = {
      header: {
        replayFormatVersion: 1,
        runtime: "realtime",
        gameId: "test-realtime",
        gameVersion: "1.0.0",
        tickRate: 60,
        rng: { algorithm: REALTIME_RNG_ALGORITHM_V1, seed: "seed" },
        initialConfig: null,
        players: [{ slotId: "a" }, { slotId: "b" }],
      },
      events: [
        { sequence: 2, tick: 0, actorSlotId: "a", input: { direction: 1 } },
      ],
      recordedRngCursor: null,
      recordedOutcome: null,
      finalTick: 1,
    };
    expect(verifyRealtimeReplay(base, resolver)).toMatchObject({
      ok: false,
      code: "SEQUENCE_GAP",
    });
    expect(
      verifyRealtimeReplay(
        {
          ...base,
          events: [
            { sequence: 1, tick: 0, actorSlotId: "x", input: { direction: 1 } },
          ],
        },
        resolver,
      ),
    ).toMatchObject({ ok: false, code: "UNKNOWN_ACTOR" });
    expect(
      verifyRealtimeReplay(
        {
          ...base,
          events: [
            { sequence: 1, tick: 0, actorSlotId: "a", input: { direction: 9 } },
          ],
        },
        resolver,
      ),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("fails closed on version, protocol, config, and canonical-input tampering", () => {
    const replay = {
      header: {
        replayFormatVersion: 1,
        runtime: "realtime",
        gameId: "test-realtime",
        gameVersion: "1.0.0",
        tickRate: 60,
        rng: { algorithm: REALTIME_RNG_ALGORITHM_V1, seed: "seed" },
        initialConfig: null,
        players: [{ slotId: "a" }, { slotId: "b" }],
      },
      events: [
        { sequence: 1, tick: 0, actorSlotId: "a", input: { direction: 1 } },
      ],
      recordedRngCursor: null,
      recordedOutcome: null,
      finalTick: 1,
    };
    expect(
      verifyRealtimeReplay(
        { ...replay, header: { ...replay.header, runtime: "turn-based" } },
        resolver,
      ),
    ).toMatchObject({ ok: false, code: "INVALID_HEADER" });
    expect(
      verifyRealtimeReplay(
        { ...replay, header: { ...replay.header, gameVersion: "2.0.0" } },
        resolver,
      ),
    ).toMatchObject({ ok: false, code: "UNKNOWN_GAME_VERSION" });
    expect(
      verifyRealtimeReplay(
        {
          ...replay,
          header: { ...replay.header, initialConfig: { forged: true } },
        },
        resolver,
      ),
    ).toMatchObject({ ok: false, code: "INVALID_CONFIG" });
    expect(
      verifyRealtimeReplay(
        {
          ...replay,
          events: [
            {
              sequence: 1,
              tick: 0,
              actorSlotId: "a",
              input: { direction: 1, forged: true },
            },
          ],
        },
        resolver,
      ),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("reconstructs bounded player-only frames and rejects non-player viewers", () => {
    const replay = {
      header: {
        replayFormatVersion: 1,
        runtime: "realtime",
        gameId: "test-realtime",
        gameVersion: "1.0.0",
        tickRate: 60,
        rng: { algorithm: REALTIME_RNG_ALGORITHM_V1, seed: "seed" },
        initialConfig: null,
        players: [{ slotId: "a" }, { slotId: "b" }],
      },
      events: [
        { sequence: 1, tick: 0, actorSlotId: "a", input: { direction: 1 } },
      ],
      recordedRngCursor: 0,
      recordedOutcome: { type: "DONE" },
      finalTick: 1,
    };
    const frames = reconstructRealtimeReplayFrames(replay, resolver, {
      kind: "player",
      slotId: "a",
    });
    expect(frames).toMatchObject({
      status: "rebuilt",
      frames: [{ tick: 0 }, { tick: 1 }],
    });
    if (frames.status === "rebuilt") {
      expect(frames.frames[0]?.view).not.toHaveProperty("seed");
      expect(Object.isFrozen(frames.frames[0]?.view)).toBe(true);
    }
    expect(
      reconstructRealtimeReplayFrames(replay, resolver, {
        kind: "player",
        slotId: "spectator",
      }),
    ).toMatchObject({ status: "invalid", code: "VIEWER_NOT_PLAYER" });
  });
});
