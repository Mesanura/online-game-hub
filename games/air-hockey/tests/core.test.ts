import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";
import { describe, expect, it } from "vitest";

import {
  airHockeyDefinition as game,
  airHockeyInputSchema,
  airHockeyStateSchema,
  COURT,
  PHYSICS,
  type AirHockeyConfig,
  type AirHockeyInput,
  type AirHockeyState,
  type Side,
} from "../src/core/index.js";

const players = [
  defineRealtimePlayerSlotId("owner"),
  defineRealtimePlayerSlotId("guest"),
] as const;
const rng = createRealtimeRng("air-hockey-tests");
const initial = (targetScore: AirHockeyConfig["targetScore"] = 7) =>
  game.createInitialState({ config: { targetScore }, players, rng }).state;
const mutable = (state: AirHockeyState) =>
  JSON.parse(JSON.stringify(state)) as AirHockeyState;
const advance = (
  state: AirHockeyState,
  inputs: readonly { side: Side; input: AirHockeyInput }[] = [],
) =>
  game.step({
    state,
    tick: state.tick,
    rng,
    inputs: inputs.map(({ side, input }) => ({ slotId: players[side], input })),
  }).state;
const target = (x: number, y: number): AirHockeyInput => ({
  type: "CONTROL",
  target: {
    x: Math.round((x / COURT.width) * PHYSICS.pointerScale),
    y: Math.round((y / COURT.height) * PHYSICS.pointerScale),
  },
});
function rally() {
  const state = mutable(initial());
  state.phase = "RALLY";
  return state;
}

describe("air hockey authority and input", () => {
  it.each([5, 7, 11] as const)(
    "initializes %i points without consuming randomness",
    (targetScore) => {
      const result = game.createInitialState({
        config: { targetScore },
        players,
        rng,
      });
      expect(result.rng).toEqual(rng);
      expect(result.state).toEqual(initial(targetScore));
      expect(result.state).toMatchObject({
        phase: "SERVE",
        server: 0,
        scores: [0, 0],
        puck: { x: 300_000, y: 510_000, velocityX: 0, velocityY: 0 },
      });
      expect(airHockeyStateSchema.parse(result.state)).toEqual(result.state);
      expect(Object.isFrozen(result.state.paddles[0])).toBe(true);
    },
  );
  it("rejects invalid configs, slots, ticks and forged fields", () => {
    for (const targetScore of [0, 6, 12, 7.1, "7"])
      expect(game.configSchema.safeParse({ targetScore }).success).toBe(false);
    expect(() =>
      game.createInitialState({
        config: { targetScore: 7 },
        players: [players[0], players[0]],
        rng,
      }),
    ).toThrow();
    for (const input of [
      { type: "CONTROL", target: { x: -1, y: 5000 } },
      { type: "CONTROL", target: { x: 5000, y: 10_001 } },
      { type: "CONTROL", target: { x: 0.5, y: 5000 } },
      { type: "CONTROL", target: { x: 0, y: Infinity } },
      { type: "CONTROL", target: null, actorSlotId: "guest" },
      { type: "CONTROL", target: null, velocityX: 20_000 },
      { type: "RESIGN", tick: 1 },
    ])
      expect(airHockeyInputSchema.safeParse(input).success).toBe(false);
    expect(() =>
      game.step({ state: initial(), tick: 2, rng, inputs: [] }),
    ).toThrow();
    expect(() =>
      game.step({
        state: initial(),
        tick: 0,
        rng,
        inputs: [
          {
            slotId: defineRealtimePlayerSlotId("outsider"),
            input: { type: "RESIGN" },
          },
        ],
      }),
    ).toThrow();
  });
  it("clamps entire paddles to their own half and bounds diagonal speed", () => {
    let state = initial();
    for (let i = 0; i < 35; i++) {
      const previous = state;
      state = advance(
        state,
        [0, 1].map((side) => ({
          side: side as Side,
          input: { type: "CONTROL", target: { x: 0, y: 0 } },
        })),
      );
      for (const side of [0, 1] as const)
        expect(
          Math.hypot(
            state.paddles[side].x - previous.paddles[side].x,
            state.paddles[side].y - previous.paddles[side].y,
          ),
        ).toBeLessThanOrEqual(PHYSICS.paddleSpeed + 1);
    }
    expect(state.paddles[0]).toMatchObject({ x: 42_000, y: 552_000 });
    expect(state.paddles[1]).toMatchObject({ x: 42_000, y: 468_000 });
    expect(state.paddles[0].y + state.paddles[1].y).toBe(COURT.height);
  });
  it("releases and expires targets, without resuming them", () => {
    let state = advance(initial(), [
      { side: 0, input: target(42_000, 800_000) },
    ]);
    state = advance(state, [
      { side: 0, input: { type: "CONTROL", target: null } },
    ]);
    const stopped = state.paddles[0];
    state = advance(state);
    expect(state.paddles[0].x).toBe(stopped.x);
    expect(state.paddles[0].y).toBe(stopped.y);
    state = advance(state, [{ side: 0, input: target(42_000, 800_000) }]);
    for (let i = 0; i < 45; i++) state = advance(state);
    expect(state.paddles[0].target).toBeNull();
    expect(state.paddles[0].inputAge).toBe(45);
  });
  it("keeps private controls and velocities out of both projections", () => {
    const state = advance(initial(), [
      { side: 0, input: target(42_000, 800_000) },
    ]);
    for (const side of [0, 1] as const) {
      const view = game.projectView({
        state,
        viewer: { kind: "player", slotId: players[side] },
      });
      expect(view.yourSide).toBe(side);
      expect(view.players.map((player) => player.color)).toEqual([
        "BLUE",
        "ORANGE",
      ]);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
      expect(JSON.stringify(view)).not.toMatch(
        /velocity|inputAge|target"|seed|cursor/,
      );
    }
    expect(() =>
      game.projectView({
        state,
        viewer: {
          kind: "player",
          slotId: defineRealtimePlayerSlotId("unknown"),
        },
      }),
    ).toThrow();
  });
});

describe("manual serves and scores", () => {
  it("waits indefinitely and ignores the receiving paddle, including its overlap", () => {
    let state = initial();
    for (let i = 0; i < 600; i++)
      state = advance(state, [{ side: 1, input: target(300_000, 510_000) }]);
    expect(state.phase).toBe("SERVE");
    expect(state.events).toEqual([]);
    expect(state.puck).toEqual(initial().puck);
    expect(state.paddles[1].y).toBe(468_000);
  });
  it("allows only the designated paddle on the launch tick", () => {
    let state = initial();
    for (let i = 0; i < 20; i++)
      state = advance(state, [{ side: 1, input: target(300_000, 510_000) }]);
    while (state.phase === "SERVE")
      state = advance(state, [{ side: 0, input: target(300_000, 510_000) }]);
    expect(
      state.events
        .filter((event) => event.kind === "PADDLE")
        .map((event) => event.side),
    ).toEqual([0]);
    expect(state.puck.velocityY).toBeLessThan(0);
  });
  it.each([0, 1] as const)(
    "scores a complete goal at side %i and gives the loser the next serve",
    (side) => {
      const state = rally();
      state.puck = {
        x: 300_000,
        y: side === 0 ? COURT.height : 0,
        velocityX: 0,
        velocityY: side === 0 ? 28_000 : -28_000,
      };
      state.paddles[0].target = { x: 42_000, y: 765_000 };
      const next = advance(state);
      expect(next.scores[side === 0 ? 1 : 0]).toBe(1);
      expect(next.server).toBe(side);
      expect(next.phase).toBe("SERVE");
      expect(next.rally).toBe(2);
      expect(next.puck).toEqual(initial().puck);
      expect(next.paddles).toEqual(initial().paddles);
      expect(next.events.at(-1)).toMatchObject({
        kind: "GOAL",
        side: side === 0 ? 1 : 0,
      });
    },
  );
  it("does not award a goal while any of the puck remains in the field", () => {
    const state = rally();
    state.puck = { x: 300_000, y: 1000, velocityX: 0, velocityY: -10_000 };
    const next = advance(state);
    expect(next.puck.y).toBe(-9000);
    expect(next.scores).toEqual([0, 0]);
    expect(advance(next).scores).toEqual([1, 0]);
  });
  it.each([5, 7, 11] as const)(
    "ends immediately at %i without a two-point lead",
    (targetScore) => {
      const state = mutable(initial(targetScore));
      state.phase = "RALLY";
      state.scores = [targetScore - 1, targetScore - 1];
      state.puck = { x: 300_000, y: 0, velocityX: 0, velocityY: -28_000 };
      const next = advance(state);
      expect(next.outcome).toEqual({
        type: "WIN",
        reason: "SCORE",
        winnerSlotId: "owner",
        scores: [targetScore, targetScore - 1],
      });
      expect(next.phase).toBe("FINISHED");
      expect(() => advance(next)).toThrow();
    },
  );
  it("prioritizes resignations in fixed player order and preserves scores", () => {
    const state = rally();
    state.scores = [2, 3];
    const next = advance(state, [
      { side: 1, input: { type: "RESIGN" } },
      { side: 0, input: { type: "RESIGN" } },
    ]);
    expect(next.outcome).toEqual({
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: "guest",
      resignedSlotId: "owner",
      scores: [2, 3],
    });
    expect(next.puck).toEqual(state.puck);
  });
});

describe("swept circle physics", () => {
  it("derives faster hits from paddle movement and caps puck speed", () => {
    const state = mutable(initial());
    state.paddles[0].y = 578_000;
    const slow = advance(state, [{ side: 0, input: target(300_000, 568_000) }]);
    const fast = advance(state, [{ side: 0, input: target(300_000, 558_000) }]);
    expect(slow.phase).toBe("RALLY");
    expect(Math.abs(fast.puck.velocityY)).toBeGreaterThan(
      Math.abs(slow.puck.velocityY),
    );
    expect(
      Math.hypot(fast.puck.velocityX, fast.puck.velocityY),
    ).toBeLessThanOrEqual(PHYSICS.puckSpeed);
  });
  it("reflects from a stationary paddle without adding energy", () => {
    const state = rally();
    state.paddles[0].y = 560_000;
    state.puck = { x: 300_000, y: 498_000, velocityX: 0, velocityY: 12_000 };
    const next = advance(state);
    expect(next.puck.velocityY).toBe(-12_000);
    expect(next.events).toHaveLength(1);
    expect(next.events[0]).toMatchObject({ kind: "PADDLE", side: 0 });
    expect(advance(next).puck.velocityY).toBe(-12_000);
  });
  it("does not tunnel through a paddle at maximum closing speed", () => {
    const state = rally();
    state.puck = { x: 300_000, y: 480_000, velocityX: 0, velocityY: 28_000 };
    state.paddles[0].y = 568_000;
    const next = advance(state, [{ side: 0, input: target(300_000, 510_000) }]);
    expect(next.puck.velocityY).toBeLessThan(0);
    expect(next.puck.y).toBeLessThan(next.paddles[0].y - COURT.paddleRadius);
  });
  it("resolves both rails in a corner and keeps wall speed", () => {
    const state = rally();
    state.puck = {
      x: 20_000,
      y: 20_000,
      velocityX: -10_000,
      velocityY: -10_000,
    };
    const next = advance(state);
    expect(next.puck.velocityX).toBe(10_000);
    expect(next.puck.velocityY).toBe(10_000);
    expect(next.events.map((event) => event.edge)).toEqual(["LEFT", "TOP"]);
    expect(next.puck.x).toBeGreaterThan(COURT.puckRadius);
    expect(next.puck.y).toBeGreaterThan(COURT.puckRadius);
  });
  it("bounces off the rounded goal post instead of scoring through it", () => {
    const state = rally();
    state.puck = {
      x: COURT.goalLeft + 9000,
      y: 25_000,
      velocityX: 0,
      velocityY: -28_000,
    };
    const next = advance(state);
    expect(
      next.events.some(
        (event) => event.kind === "WALL" && event.edge === "TOP",
      ),
    ).toBe(true);
    expect(next.scores).toEqual([0, 0]);
    expect(next.puck.velocityX).toBeGreaterThan(0);
    expect(next.puck.velocityY).toBeGreaterThan(0);
  });
  it("keeps a squeezed puck inside the rail and releases when the paddle moves away", () => {
    let state = rally();
    state.paddles[0] = { x: 79_000, y: 800_000, target: null, inputAge: 45 };
    state.puck = { x: 19_000, y: 800_000, velocityX: 0, velocityY: 0 };
    for (let i = 0; i < 20; i++) {
      state = advance(state, [{ side: 0, input: target(0, 800_000) }]);
      expect(state.puck.x).toBeGreaterThanOrEqual(COURT.puckRadius);
      expect(airHockeyStateSchema.safeParse(state).success).toBe(true);
    }
    const trappedX = state.paddles[0].x;
    state = advance(state, [{ side: 0, input: target(300_000, 800_000) }]);
    expect(state.paddles[0].x).toBeGreaterThan(trappedX);
  });
  it("prunes old events and maintains bounded unique event ids", () => {
    const state = rally();
    state.tick = 100;
    state.eventSequence = 64;
    state.events = Array.from({ length: 64 }, (_, i) => ({
      id: i + 1,
      tick: i === 0 ? 0 : 99,
      kind: "WALL" as const,
      x: 0,
      y: 300_000,
      strength: 500,
      side: null,
      edge: "LEFT" as const,
    }));
    state.puck = { x: 19_000, y: 300_000, velocityX: -28_000, velocityY: 0 };
    const next = advance(state);
    expect(next.events).toHaveLength(64);
    expect(next.events[0]?.id).toBe(2);
    expect(next.events.at(-1)?.id).toBe(65);
  });
  it("preserves JSON, half-field and speed invariants through deterministic mixed input", () => {
    let state = initial(11);
    let seed = 19283;
    for (let i = 0; i < 1800; i++) {
      const previous = JSON.stringify(state);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const inputs = ([0, 1] as const).map((side) => ({
        side,
        input: {
          type: "CONTROL" as const,
          target:
            state.phase === "SERVE"
              ? {
                  x: side === state.server ? 5000 : 1000,
                  y: side === state.server ? 5000 : 7500,
                }
              : { x: (seed >>> (side * 8)) % 10001, y: 5000 + (seed % 5001) },
        },
      }));
      const next = advance(state, inputs);
      expect(next).toEqual(advance(mutable(state), inputs));
      expect(JSON.stringify(state)).toBe(previous);
      expect(airHockeyStateSchema.safeParse(next).success).toBe(true);
      expect(
        Math.hypot(next.puck.velocityX, next.puck.velocityY),
      ).toBeLessThanOrEqual(PHYSICS.puckSpeed);
      state = next.outcome === null ? next : initial(11);
    }
  });
});
