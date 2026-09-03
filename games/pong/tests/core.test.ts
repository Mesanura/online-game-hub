import { describe, expect, it } from "vitest";

import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";
import type {
  RealtimePlayerInput,
  RealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";

import {
  PONG_BALL_RADIUS,
  PONG_FIELD_HEIGHT,
  PONG_FIELD_WIDTH,
  PONG_LEFT_PADDLE_X,
  PONG_PADDLE_HEIGHT,
  PONG_PADDLE_SPEED,
  PONG_PADDLE_WIDTH,
  createInitialState,
  getOutcome,
  pongConfigSchema,
  pongInputSchema,
  pongStateSchema,
  projectView,
  step,
} from "../src/core/index.js";
import type { PongInput, PongState } from "../src/core/index.js";

const left = defineRealtimePlayerSlotId("left-slot");
const right = defineRealtimePlayerSlotId("right-slot");
const players = [left, right] as const;

function initial(targetScore = 3) {
  return createInitialState({
    config: { targetScore },
    players,
    rng: createRealtimeRng("pong-test-seed"),
  });
}

function withState(
  state: PongState,
  replacement: Partial<PongState>,
): PongState {
  return pongStateSchema.parse({
    ...state,
    ...replacement,
  }) as unknown as PongState;
}

function change(
  slotId: RealtimePlayerSlotId,
  input: PongInput,
): RealtimePlayerInput<PongInput> {
  return { slotId, input };
}

describe("Pong initialization and schemas", () => {
  it("creates the same immutable integer state for the same seed", () => {
    const first = initial();
    const second = initial();
    expect(first).toEqual(second);
    expect(first.state).toMatchObject({
      players,
      targetScore: 3,
      tick: 0,
      paddles: [
        { y: PONG_FIELD_HEIGHT / 2, direction: 0 },
        { y: PONG_FIELD_HEIGHT / 2, direction: 0 },
      ],
      scores: [0, 0],
    });
    expect(first.rng.cursor).toBe(2);
    expect(Object.isFrozen(first.state)).toBe(true);
    expect(JSON.parse(JSON.stringify(first.state))).toEqual(first.state);
  });

  it("rejects invalid config, input and player slots", () => {
    expect(pongConfigSchema.safeParse({ targetScore: 0 }).success).toBe(false);
    expect(
      pongConfigSchema.safeParse({ targetScore: 3, extra: true }).success,
    ).toBe(false);
    expect(
      pongInputSchema.safeParse({ type: "DIRECTION", direction: 2 }).success,
    ).toBe(false);
    expect(
      pongInputSchema.safeParse({ type: "RESIGN", actor: "left-slot" }).success,
    ).toBe(false);
    expect(() =>
      createInitialState({
        config: { targetScore: 3 },
        players: [left, left],
        rng: createRealtimeRng("seed"),
      }),
    ).toThrow("exactly two distinct");
  });
});

describe("Pong input and paddle movement", () => {
  it.each([
    [-1, -PONG_PADDLE_SPEED],
    [0, 0],
    [1, PONG_PADDLE_SPEED],
  ] as const)("applies direction %s", (direction, delta) => {
    const game = initial();
    const result = step({
      state: game.state,
      tick: 0,
      inputs: [change(left, { type: "DIRECTION", direction })],
      rng: game.rng,
    });
    expect(result.state.paddles[0]).toEqual({
      y: PONG_FIELD_HEIGHT / 2 + delta,
      direction,
    });
  });

  it("keeps the last direction when a tick has no input change", () => {
    const game = initial();
    const moving = step({
      state: game.state,
      tick: 0,
      inputs: [change(left, { type: "DIRECTION", direction: -1 })],
      rng: game.rng,
    });
    const continued = step({
      state: moving.state,
      tick: 1,
      inputs: [],
      rng: moving.rng,
    });
    expect(continued.state.paddles[0].y).toBe(
      PONG_FIELD_HEIGHT / 2 - PONG_PADDLE_SPEED * 2,
    );
  });

  it("clamps paddles and enforces stable, unique input order", () => {
    const game = initial();
    const atTop = withState(game.state, {
      paddles: [
        { y: PONG_PADDLE_HEIGHT / 2, direction: -1 },
        game.state.paddles[1],
      ],
    });
    expect(
      step({ state: atTop, tick: 0, inputs: [], rng: game.rng }).state
        .paddles[0].y,
    ).toBe(PONG_PADDLE_HEIGHT / 2);
    expect(() =>
      step({
        state: game.state,
        tick: 0,
        inputs: [
          change(right, { type: "DIRECTION", direction: 1 }),
          change(left, { type: "DIRECTION", direction: -1 }),
        ],
        rng: game.rng,
      }),
    ).toThrow("stable slot order");
    expect(() =>
      step({
        state: game.state,
        tick: 0,
        inputs: [
          change(left, { type: "DIRECTION", direction: 1 }),
          change(left, { type: "DIRECTION", direction: 0 }),
        ],
        rng: game.rng,
      }),
    ).toThrow("duplicate slot");
  });
});

describe("Pong collisions, scoring and outcome", () => {
  it("reflects from the top boundary using integer coordinates", () => {
    const game = initial();
    const state = withState(game.state, {
      ball: {
        x: 400_000,
        y: PONG_BALL_RADIUS + 1_000,
        velocityX: 6_000,
        velocityY: -3_000,
      },
    });
    const result = step({ state, tick: 0, inputs: [], rng: game.rng });
    expect(result.state.ball.velocityY).toBe(3_000);
    expect(Number.isInteger(result.state.ball.y)).toBe(true);
  });

  it("handles boundary then paddle collision in the documented tie-break", () => {
    const game = initial();
    const surface = PONG_LEFT_PADDLE_X + PONG_PADDLE_WIDTH / 2;
    const state = withState(game.state, {
      paddles: [
        { y: PONG_PADDLE_HEIGHT / 2, direction: 0 },
        game.state.paddles[1],
      ],
      ball: {
        x: surface + PONG_BALL_RADIUS + 1_000,
        y: PONG_BALL_RADIUS + 1_000,
        velocityX: -6_000,
        velocityY: -3_000,
      },
    });
    const result = step({ state, tick: 0, inputs: [], rng: game.rng });
    expect(result.state.ball.velocityX).toBeGreaterThan(0);
    expect(result.state.ball.x).toBe(surface + PONG_BALL_RADIUS);
  });

  it("misses the paddle, scores and deterministically serves again", () => {
    const game = initial();
    const state = withState(game.state, {
      ball: {
        x: -3_000,
        y: PONG_FIELD_HEIGHT - 10_000,
        velocityX: -6_000,
        velocityY: 0,
      },
    });
    const result = step({ state, tick: 0, inputs: [], rng: game.rng });
    expect(result.state.scores).toEqual([0, 1]);
    expect(result.state.ball).toMatchObject({
      x: PONG_FIELD_WIDTH / 2,
      y: PONG_FIELD_HEIGHT / 2,
    });
    expect(result.rng.cursor).toBe(game.rng.cursor + 2);
  });

  it("finishes at target score and no longer advances", () => {
    const game = initial(1);
    const state = withState(game.state, {
      ball: {
        x: -3_000,
        y: PONG_FIELD_HEIGHT - 10_000,
        velocityX: -6_000,
        velocityY: 0,
      },
    });
    const result = step({ state, tick: 0, inputs: [], rng: game.rng });
    expect(getOutcome(result.state)).toEqual({
      type: "WIN",
      reason: "SCORE",
      winnerSlotId: right,
      scores: [0, 1],
    });
    expect(() =>
      step({ state: result.state, tick: 1, inputs: [], rng: result.rng }),
    ).toThrow("already finished");
  });

  it("accepts off-turn resignation as an authoritative input", () => {
    const game = initial();
    const result = step({
      state: game.state,
      tick: 0,
      inputs: [change(right, { type: "RESIGN" })],
      rng: game.rng,
    });
    expect(getOutcome(result.state)).toEqual({
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: left,
      resignedSlotId: right,
      scores: [0, 0],
    });
  });
});

describe("Pong purity, projection and determinism", () => {
  it("does not mutate State, Input or RNG and exposes no seed", () => {
    const game = initial();
    const input = Object.freeze({ type: "DIRECTION", direction: 1 } as const);
    const beforeState = structuredClone(game.state);
    const beforeRng = structuredClone(game.rng);
    step({
      state: game.state,
      tick: 0,
      inputs: [change(left, input)],
      rng: game.rng,
    });
    expect(game.state).toEqual(beforeState);
    expect(game.rng).toEqual(beforeRng);
    expect(input).toEqual({ type: "DIRECTION", direction: 1 });
    const view = projectView({
      state: game.state,
      viewer: { kind: "player", slotId: left },
    });
    expect(view.yourSide).toBe("LEFT");
    expect(view).not.toHaveProperty("rng");
    expect(view).not.toHaveProperty("directions");
    expect(JSON.stringify(view)).not.toContain("pong-test-seed");
    expect(Object.isFrozen(view)).toBe(true);
  });

  it("repeats the same State, RNG and Outcome for a fixed input log", () => {
    const run = () => {
      let game = initial();
      for (let tick = 0; tick < 80; tick += 1) {
        const inputs =
          tick === 0
            ? [change(left, { type: "DIRECTION", direction: -1 })]
            : tick === 20
              ? [change(right, { type: "DIRECTION", direction: 1 })]
              : tick === 40
                ? [change(left, { type: "DIRECTION", direction: 0 })]
                : [];
        game = step({ state: game.state, tick, inputs, rng: game.rng });
      }
      return { ...game, outcome: getOutcome(game.state) };
    };
    expect(run()).toEqual(run());
  });
});
