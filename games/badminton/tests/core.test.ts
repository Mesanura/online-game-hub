import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";
import { describe, expect, it } from "vitest";

import {
  COURT,
  PHYSICS,
  badmintonConfigSchema,
  badmintonInputSchema,
  badmintonStateSchema,
  createInitialState,
  getOutcome,
  projectView,
  step,
  type BadmintonControls,
  type BadmintonInput,
  type BadmintonSide,
  type BadmintonState,
} from "../src/core/index.js";

const players = [
  defineRealtimePlayerSlotId("left-slot"),
  defineRealtimePlayerSlotId("right-slot"),
] as const;
const rng = createRealtimeRng("badminton-unit-seed");
const neutral = { move: 0, jump: false, serve: false, shot: "NONE" } as const;
function initial(targetScore: 7 | 11 | 21 = 7) {
  return createInitialState({ config: { targetScore }, players, rng }).state;
}
function advance(
  state: BadmintonState,
  controls?: Partial<BadmintonControls>,
  side: BadmintonSide = 0,
) {
  return step({
    state,
    tick: state.tick,
    rng,
    inputs:
      controls === undefined
        ? []
        : [
            {
              slotId: players[side],
              input: { type: "CONTROL", ...neutral, ...controls },
            },
          ],
  }).state;
}
function rally(patch: Partial<BadmintonState> = {}): BadmintonState {
  return {
    ...structuredClone(initial()),
    phase: "RALLY",
    phaseTicks: 0,
    shuttle: {
      x: 700_000,
      y: 200_000,
      velocityX: -6_000,
      velocityY: 1_000,
      lastHit: 1,
    },
    ...patch,
  };
}
function grounded(side: BadmintonSide, x = side === 0 ? 250_000 : 750_000) {
  return rally({
    shuttle: {
      x,
      y: COURT.ground - COURT.shuttleRadius - 1_000,
      velocityX: 0,
      velocityY: 4_000,
      lastHit: side === 0 ? 1 : 0,
    },
  });
}

describe("badminton schemas and initialization", () => {
  it("has deterministic, detached, frozen, JSON-safe initial state and no gameplay RNG consumption", () => {
    const config = Object.freeze({ targetScore: 7 as const });
    const source = Object.freeze({ ...rng });
    const first = createInitialState({ config, players, rng: source });
    expect(first).toEqual(createInitialState({ config, players, rng: source }));
    expect(first.state).toMatchObject({
      phase: "SERVE",
      tick: 0,
      phaseTicks: 0,
      scores: [0, 0],
      server: 0,
    });
    expect(first.rng).toEqual(source);
    expect(Object.isFrozen(first.state.athletes[0].controls)).toBe(true);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(badmintonConfigSchema.parse(config)).toEqual(config);
  });

  it.each([
    null,
    {},
    { targetScore: 1 },
    { targetScore: 7.5 },
    { targetScore: 7, actor: "fake" },
  ])("rejects invalid config %j", (config) => {
    expect(badmintonConfigSchema.safeParse(config).success).toBe(false);
  });

  it.each([
    {},
    { type: "CONTROL", ...neutral, move: 2 },
    { type: "CONTROL", ...neutral, jump: 1 },
    { type: "CONTROL", ...neutral, shot: "TELEPORT" },
    { type: "RESIGN", actor: "opponent" },
    { type: "CONTROL", ...neutral, x: 100 },
    { type: "CONTROL", ...neutral, tick: 10 },
    { type: "CONTROL", ...neutral, scores: [7, 0] },
    { type: "CONTROL", ...neutral, velocityX: 99 },
  ])("rejects malformed or forged input %j", (input) => {
    expect(badmintonInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects missing/duplicate slots, wrong tick, foreign actor and unsorted or repeated input slots", () => {
    expect(() =>
      createInitialState({
        config: { targetScore: 7 },
        players: [players[0]],
        rng,
      }),
    ).toThrow("exactly two distinct");
    expect(() =>
      createInitialState({
        config: { targetScore: 7 },
        players: [players[0], players[0]],
        rng,
      }),
    ).toThrow("exactly two distinct");
    const state = initial();
    expect(() => step({ state, tick: 2, inputs: [], rng })).toThrow(
      "not contiguous",
    );
    const input: BadmintonInput = { type: "CONTROL", ...neutral };
    for (const slots of [
      [players[1], players[0]],
      [players[0], players[0]],
    ]) {
      expect(() =>
        step({
          state,
          tick: 0,
          rng,
          inputs: slots.map((slotId) => ({ slotId, input })),
        }),
      ).toThrow("unique stable slot order");
    }
    expect(() =>
      step({
        state,
        tick: 0,
        rng,
        inputs: [{ slotId: defineRealtimePlayerSlotId("outsider"), input }],
      }),
    ).toThrow("not a player");
  });
});

describe("movement and input safety", () => {
  it.each([-1, 0, 1] as const)(
    "moves both sides in world direction %s",
    (move) => {
      for (const side of [0, 1] as const) {
        const state = rally();
        expect(advance(state, { move }, side).athletes[side].x).toBe(
          state.athletes[side].x + move * PHYSICS.runSpeed,
        );
      }
    },
  );

  it("clamps both sides at the net and outer edges", () => {
    for (const side of [0, 1] as const) {
      for (const move of [-1, 1] as const) {
        let state = rally();
        for (let tick = 0; tick < 65; tick += 1)
          state = advance(state, { move }, side);
        const bounds = side === 0 ? [30_000, 465_000] : [535_000, 970_000];
        expect(state.athletes[side].x).toBe(bounds[move === -1 ? 0 : 1]);
      }
    }
  });

  it("jumps once per press, lands, and requires release before the next jump", () => {
    let state = advance(initial(), { jump: true });
    expect(state.athletes[0].y).toBeLessThan(COURT.ground);
    for (let tick = 0; tick < 50; tick += 1)
      state = advance(state, { jump: true });
    expect(state.athletes[0]).toMatchObject({ y: COURT.ground, velocityY: 0 });
    state = advance(state, { jump: false });
    expect(advance(state, { jump: true }).athletes[0].y).toBeLessThan(
      COURT.ground,
    );
  });

  it("continues held movement, accepts release and expires lost input", () => {
    const moving = advance(rally(), { move: 1, shot: "CLEAR" });
    expect(advance(moving).athletes[0].x).toBe(
      moving.athletes[0].x + PHYSICS.runSpeed,
    );
    expect(advance(moving, neutral).athletes[0].x).toBe(moving.athletes[0].x);
    let state = moving;
    for (let tick = 0; tick <= PHYSICS.inputLease; tick += 1)
      state = advance(state);
    expect(state.athletes[0].controls).toEqual(neutral);
    expect(advance(state).athletes[0].x).toBe(state.athletes[0].x);
  });

  it("does not restart an active swing on each input heartbeat", () => {
    const first = advance(rally(), { shot: "CLEAR" });
    expect(first.athletes[0].swingTicks).toBe(10);
    const second = advance(first, { shot: "CLEAR" });
    expect(second.athletes[0].swingTicks).toBe(9);
    expect(second.athletes[0].cooldown).toBe(23);
  });
});

describe("serving and racket contacts", () => {
  it("waits indefinitely and only releases the server's held shuttle on the sixth serve tick", () => {
    let state = initial();
    for (let tick = 0; tick < 2000; tick += 1)
      state = advance(state, { shot: "SMASH", serve: true }, 1);
    expect(state).toMatchObject({
      phase: "SERVE",
      phaseTicks: 0,
      rallyHits: 0,
    });
    state = advance(state, { serve: true });
    expect(state.phase).toBe("SERVING");
    for (let tick = 1; tick < PHYSICS.serveContactTick - 1; tick++) {
      state = advance(state, { serve: true });
      expect(state.phase).toBe("SERVING");
      expect(state.shuttle.lastHit).toBeNull();
    }
    state = advance(state, { serve: true });
    expect(state).toMatchObject({
      phase: "RALLY",
      phaseTicks: 0,
      rallyHits: 1,
      shuttle: { lastHit: 0 },
    });
    expect(state.shuttle.velocityX).toBeGreaterThan(0);
    expect(state.shuttle.velocityY).toBeLessThan(0);
    expect(state.athletes[0].swingTicks).toBe(13);
  });

  it.each(["CLEAR", "DROP"] as const)(
    "returns a reachable shuttle with %s",
    (shot) => {
      const state = rally({
        shuttle: {
          x: 280_000,
          y: 395_000,
          velocityX: -3_000,
          velocityY: 500,
          lastHit: 1,
        },
      });
      const next = advance(state, { shot });
      expect(next.shuttle.lastHit).toBe(0);
      expect(next.shuttle.velocityX).toBeGreaterThan(0);
      expect(next.rallyHits).toBe(1);
      expect(next.athletes[0].hitThisSwing).toBe(true);
      const continued = advance(next, { shot });
      expect(continued.rallyHits).toBe(1);
    },
  );

  it("mirrors right-side returns and forbids consecutive or cross-net hits", () => {
    const right = rally({
      shuttle: {
        x: 720_000,
        y: 395_000,
        velocityX: 3_000,
        velocityY: 500,
        lastHit: 0,
      },
    });
    const returned = advance(right, { shot: "CLEAR" }, 1);
    expect(returned.shuttle.lastHit).toBe(1);
    expect(returned.shuttle.velocityX).toBeLessThan(0);
    const duplicate = advance(
      { ...right, shuttle: { ...right.shuttle, lastHit: 1 } },
      { shot: "CLEAR" },
      1,
    );
    expect(duplicate.rallyHits).toBe(0);
    const across = structuredClone(right);
    across.athletes[1].x = 535_000;
    across.athletes[1].y = 390_000;
    across.shuttle = {
      x: 480_000,
      y: 290_000,
      velocityX: -100,
      velocityY: 0,
      lastHit: 0,
    };
    expect(advance(across, { shot: "SMASH" }, 1).rallyHits).toBe(0);
  });

  it("needs reach and a live swing window", () => {
    const distant = advance(rally(), { shot: "CLEAR" });
    expect(distant.rallyHits).toBe(0);
    const near = rally({
      shuttle: {
        x: 280_000,
        y: 395_000,
        velocityX: -3_000,
        velocityY: 500,
        lastHit: 1,
      },
    });
    expect(advance(near).rallyHits).toBe(0);
  });

  it("uses a fast downward smash only on a high airborne contact", () => {
    const high = rally();
    high.athletes[0].x = 410_000;
    high.athletes[0].y = 390_000;
    high.athletes[0].velocityY = 0;
    high.shuttle = {
      x: 450_000,
      y: 280_000,
      velocityX: -4_000,
      velocityY: 0,
      lastHit: 1,
    };
    const smash = advance(high, { shot: "SMASH" });
    expect(smash.athletes[0].swingShot).toBe("SMASH");
    expect(smash.shuttle.velocityY).toBeGreaterThan(0);
    const groundedContact = rally({
      shuttle: {
        x: 280_000,
        y: 395_000,
        velocityX: -3_000,
        velocityY: 500,
        lastHit: 1,
      },
    });
    const fallback = advance(groundedContact, { shot: "SMASH" });
    expect(fallback.athletes[0].swingShot).toBe("CLEAR");
    expect(fallback.shuttle.velocityY).toBeLessThan(0);
  });

  it("produces distinct clear, drop and smash landings using integer drag", () => {
    const results = { CLEAR: 0, DROP: 0, SMASH: 0 };
    for (const shot of ["CLEAR", "DROP", "SMASH"] as const) {
      const state = rally();
      state.athletes[0].x = 410_000;
      state.athletes[0].y = 390_000;
      state.shuttle = {
        x: 450_000,
        y: 280_000,
        velocityX: -100,
        velocityY: 0,
        lastHit: 1,
      };
      let next = advance(state, { shot });
      for (let tick = 0; tick < 120 && next.phase === "RALLY"; tick += 1)
        next = advance(next, neutral);
      expect(next.lastPoint).toMatchObject({ reason: "GROUND", winner: 0 });
      if (next.lastPoint === null) throw new Error("Expected a landing");
      expect(next.lastPoint.x).toBeGreaterThan(COURT.netX);
      expect(next.lastPoint.x).toBeLessThan(COURT.rightLine);
      results[shot] = next.lastPoint.x;
    }
    expect(results.DROP).toBeLessThan(results.SMASH);
    expect(results.SMASH).toBeLessThan(results.CLEAR);
  });
});

describe("collision and scoring rules", () => {
  it.each([0, 1] as const)(
    "awards the opponent when the shuttle lands in side %s",
    (side) => {
      const next = advance(grounded(side));
      expect(next.scores).toEqual(side === 0 ? [0, 1] : [1, 0]);
      expect(next.lastPoint).toMatchObject({
        winner: side === 0 ? 1 : 0,
        reason: "GROUND",
      });
      expect(next.phase).toBe("POINT");
    },
  );

  it.each([COURT.leftLine, COURT.rightLine])(
    "counts a landing exactly on line %s as in",
    (x) => {
      expect(
        advance(grounded(x < COURT.netX ? 0 : 1, x)).lastPoint?.reason,
      ).toBe("GROUND");
    },
  );

  it.each([COURT.leftLine - 1, COURT.rightLine + 1])(
    "charges an out landing at %s to the hitter",
    (x) => {
      const state = grounded(0, x);
      state.shuttle.lastHit = 0;
      expect(advance(state).lastPoint).toMatchObject({
        winner: 1,
        reason: "OUT",
      });
    },
  );

  it("judges the ground crossing before the overshot endpoint leaves the court", () => {
    const state = grounded(1, COURT.rightLine - 500);
    state.shuttle.velocityX = 20_000;
    state.shuttle.y = COURT.ground - COURT.shuttleRadius - 100;
    expect(advance(state).lastPoint?.reason).toBe("GROUND");
  });

  it.each([0, 1] as const)(
    "catches a fast shuttle crossing the net from side %s",
    (side) => {
      const state = rally({
        shuttle: {
          x: side === 0 ? 487_000 : 513_000,
          y: 350_000,
          velocityX: side === 0 ? 28_000 : -28_000,
          velocityY: 0,
          lastHit: side,
        },
      });
      const next = advance(state);
      expect(next.lastPoint).toMatchObject({
        winner: side === 0 ? 1 : 0,
        reason: "NET",
      });
      expect(next.scores[side]).toBe(0);
      expect(next.phaseTicks).toBe(90);
    },
  );

  it("lets a high shuttle clear the net and does not call air outside a line out", () => {
    const high = rally({
      shuttle: {
        x: 487_000,
        y: 300_000,
        velocityX: 28_000,
        velocityY: 0,
        lastHit: 0,
      },
    });
    expect(advance(high).phase).toBe("RALLY");
    const outside = rally({
      shuttle: {
        x: 50_000,
        y: 200_000,
        velocityX: 5_000,
        velocityY: 0,
        lastHit: 0,
      },
    });
    expect(advance(outside).phase).toBe("RALLY");
  });

  it("waits after a point, resets positions, and gives the scorer the next serve", () => {
    let state = advance(grounded(0));
    const frozenScore = [...state.scores];
    for (let tick = 0; tick < PHYSICS.pointDelay; tick += 1)
      state = advance(state);
    expect(state).toMatchObject({
      phase: "SERVE",
      phaseTicks: 0,
      server: 1,
      rally: 2,
      rallyHits: 0,
    });
    expect(state.scores).toEqual(frozenScore);
    expect(state.athletes.map((player) => player.x)).toEqual([
      240_000, 760_000,
    ]);
  });

  it.each([
    [7, 11],
    [11, 15],
    [21, 30],
  ] as const)(
    "requires a two point lead at target %s and caps at %s",
    (target, cap) => {
      const state = {
        ...grounded(1),
        targetScore: target,
        scores: [target - 1, target - 1] as [number, number],
      };
      const deuce = advance(state);
      expect(getOutcome(deuce)).toBeNull();
      const win = advance({
        ...grounded(1),
        targetScore: target,
        scores: [target, target - 1],
      });
      expect(getOutcome(win)).toMatchObject({
        reason: "SCORE",
        winnerSlotId: players[0],
        scores: [target + 1, target - 1],
      });
      const capped = advance({
        ...grounded(1),
        targetScore: target,
        scores: [cap - 1, cap - 1],
      });
      expect(getOutcome(capped)).toMatchObject({ scores: [cap, cap - 1] });
      expect(() => advance(capped)).toThrow("already finished");
    },
  );

  it("accepts either player's resignation, with deterministic simultaneous resignation", () => {
    for (const side of [0, 1] as const) {
      const state = initial();
      const next = step({
        state,
        tick: 0,
        rng,
        inputs: [{ slotId: players[side], input: { type: "RESIGN" } }],
      }).state;
      expect(getOutcome(next)).toEqual({
        type: "WIN",
        reason: "RESIGNATION",
        winnerSlotId: players[side === 0 ? 1 : 0],
        resignedSlotId: players[side],
        scores: [0, 0],
      });
      expect(() => advance(next)).toThrow("already finished");
    }
    const both = step({
      state: initial(),
      tick: 0,
      rng,
      inputs: players.map((slotId) => ({ slotId, input: { type: "RESIGN" } })),
    }).state;
    expect(both.resignedSlotId).toBe(players[0]);
  });
});

describe("purity, projection and complete deterministic matches", () => {
  it("keeps inputs and state immutable and projects only public detached data for each viewer", () => {
    const state = initial();
    const before = JSON.stringify(state);
    const input = Object.freeze({
      type: "CONTROL",
      ...neutral,
      move: 1,
    } as const);
    step({
      state,
      tick: 0,
      rng: Object.freeze({ ...rng }),
      inputs: [{ slotId: players[0], input }],
    });
    expect(JSON.stringify(state)).toBe(before);
    for (const slotId of [
      ...players,
      defineRealtimePlayerSlotId("spectator"),
    ]) {
      const view = projectView({ state, viewer: { kind: "player", slotId } });
      expect(view.yourSide).toBe(
        slotId === players[0] ? "LEFT" : slotId === players[1] ? "RIGHT" : null,
      );
      expect(view.athletes[0]).not.toHaveProperty("controls");
      expect(view.athletes[0]).not.toHaveProperty("inputAge");
      expect(view.shuttle).not.toHaveProperty("lastHit");
      expect(view.shuttle).not.toHaveProperty("velocityX");
      expect(JSON.stringify(view)).not.toContain(rng.seed);
      expect(view.athletes[0]).not.toBe(state.athletes[0]);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    }
  });

  it("completes manually served matches by actual scoring without consuming RNG", () => {
    const run = () => {
      let current = createInitialState({
        config: { targetScore: 7 },
        players,
        rng,
      });
      while (getOutcome(current.state) === null && current.state.tick < 4_000) {
        current = step({
          ...current,
          tick: current.state.tick,
          inputs: [
            {
              slotId: players[current.state.server],
              input: {
                type: "CONTROL",
                ...neutral,
                serve: current.state.phase === "SERVE",
              },
            },
          ],
        });
        expect(badmintonStateSchema.safeParse(current.state).success).toBe(
          true,
        );
      }
      return current;
    };
    const first = run();
    expect(getOutcome(first.state)).toMatchObject({
      reason: "SCORE",
      scores: [7, 0],
    });
    expect(first.rng.cursor).toBe(0);
    expect(run()).toEqual(first);
  });

  it("keeps integer, serialized invariants through mixed movement, jump and shot sequences", () => {
    const run = () => {
      let state = initial(21);
      for (
        let tick = 0;
        tick < 1_500 && getOutcome(state) === null;
        tick += 1
      ) {
        const inputs = players.map((slotId, index) => ({
          slotId,
          input: {
            type: "CONTROL",
            move: (((Math.floor(tick / 30) + index) % 3) - 1) as -1 | 0 | 1,
            jump: tick % 55 < 20,
            serve: state.phase === "SERVE",
            shot:
              (["CLEAR", "DROP", "SMASH"] as const)[
                Math.floor(tick / 45) % 3
              ] ?? "CLEAR",
          } as const,
        }));
        state = step({ state, tick, inputs, rng }).state;
        expect(badmintonStateSchema.safeParse(state).success).toBe(true);
      }
      return state;
    };
    expect(run()).toEqual(run());
  });
});
