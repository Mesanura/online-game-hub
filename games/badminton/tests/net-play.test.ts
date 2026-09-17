import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";
import { describe, expect, it } from "vitest";
import {
  badmintonDefinition,
  badmintonDefinitionV1_2_0,
  badmintonDefinitionV1_3_0,
  badmintonStateSchema,
  COURT,
  PHYSICS,
  type BadmintonControls,
  type BadmintonSide,
  type BadmintonState,
} from "../src/core/index.js";

const players = [
  defineRealtimePlayerSlotId("left"),
  defineRealtimePlayerSlotId("right"),
] as const;
const rng = createRealtimeRng("badminton-net-play");
const neutral = { move: 0, jump: false, serve: false, shot: "NONE" } as const;
type Definition =
  | typeof badmintonDefinition
  | typeof badmintonDefinitionV1_2_0
  | typeof badmintonDefinitionV1_3_0;
const other = (side: BadmintonSide): BadmintonSide => (side === 0 ? 1 : 0);
const mirror = (x: number, side: BadmintonSide) =>
  side === 0 ? x : COURT.width - x;

function initial(): BadmintonState {
  return structuredClone(
    badmintonDefinition.createInitialState({
      config: { targetScore: 7, speedLevel: 1 },
      players,
      rng,
    }).state,
  );
}

function landingX(state: BadmintonState): number {
  if (state.lastPoint === null) throw new Error("Expected a shuttle landing.");
  return state.lastPoint.x;
}

function advance(
  state: BadmintonState,
  controls: readonly [
    Partial<BadmintonControls>,
    Partial<BadmintonControls>,
  ] = [{}, {}],
  definition: Definition = badmintonDefinition,
): BadmintonState {
  const selected = definition as any;
  const inputState =
    selected.manifest.gameVersion === "1.5.0"
      ? state
      : (() => {
          const { speedLevel: _speedLevel, ...legacy } = structuredClone(state);
          return legacy;
        })();
  return selected.step({
    state: inputState,
    tick: state.tick,
    rng,
    inputs: players.map((slotId, side) => ({
      slotId,
      input: { type: "CONTROL", ...neutral, ...controls[side] },
    })),
  }).state as BadmintonState;
}

function contact(
  side: BadmintonSide,
  x = 450_000,
  y = 280_000,
): BadmintonState {
  const state = initial();
  state.phase = "RALLY";
  state.athletes[side].x = mirror(x - 40_000, side);
  state.athletes[side].y = y < 320_000 ? 390_000 : COURT.ground;
  state.shuttle = {
    x: mirror(x, side),
    y,
    velocityX: side === 0 ? -100 : 100,
    velocityY: 1_000,
    lastHit: other(side),
  };
  return state;
}

function hit(
  state: BadmintonState,
  side: BadmintonSide,
  controls: Partial<BadmintonControls>,
  definition: Definition = badmintonDefinition,
) {
  return advance(
    state,
    side === 0 ? [controls, {}] : [{}, controls],
    definition,
  );
}

function lift(lifter: BadmintonSide, x: number, y: number, jumpPhase: number) {
  const state = initial();
  state.phase = "RALLY";
  state.athletes[0].x = 465_000;
  state.athletes[1].x = 535_000;
  const camper = state.athletes[other(lifter)];
  camper.velocityY = -PHYSICS.jumpSpeed;
  for (let tick = 0; tick < jumpPhase; tick++) {
    camper.velocityY += PHYSICS.playerGravity;
    camper.y = Math.min(COURT.ground, camper.y + camper.velocityY);
    if (camper.y === COURT.ground) camper.velocityY = 0;
  }
  state.shuttle = {
    x: mirror(x, other(lifter)),
    y,
    velocityX: lifter === 1 ? 100 : -100,
    velocityY: 1_000,
    lastHit: other(lifter),
  };
  return state;
}

function campAgainstLift(
  lifter: BadmintonSide,
  x: number,
  y: number,
  jumpPhase: number,
  swingDelay: number,
  shot: "DROP" | "SMASH",
  definition: Definition = badmintonDefinition,
) {
  let state = lift(lifter, x, y, jumpPhase);
  for (let tick = 0; tick < 140 && state.phase === "RALLY"; tick++) {
    const returning = { shot: tick === 0 ? "CLEAR" : "NONE" } as const;
    const camping = { shot: tick >= swingDelay ? shot : "NONE" } as const;
    state = advance(
      state,
      lifter === 0 ? [returning, camping] : [camping, returning],
      definition,
    );
    if (state.rallyHits > 1) break;
  }
  return state;
}

describe("forecourt pressure has a playable escape", () => {
  it("reproduces the old immediate re-smash and makes the same lift pass the net camper", () => {
    const old = campAgainstLift(
      1,
      550_000,
      340_000,
      20,
      0,
      "SMASH",
      badmintonDefinitionV1_2_0,
    );
    expect(old.rallyHits).toBe(2);
    expect(old.athletes[0].lastContact?.shot).toBe("SMASH");
    const current = campAgainstLift(1, 550_000, 340_000, 20, 0, "SMASH");
    expect(current.rallyHits).toBe(1);
    expect(current.lastPoint).toMatchObject({ winner: 1, reason: "GROUND" });
    expect(current.lastPoint?.x).toBeLessThan(150_000);
  });

  it.each([0, 1] as const)(
    "lifts over a stationary camper on side %s across jump and swing timings",
    (lifter) => {
      for (const [x, y] of [
        [550_000, 340_000],
        [560_000, 360_000],
        [570_000, 400_000],
      ] as const) {
        for (const jumpPhase of [0, 10, 20, 30, 40]) {
          for (const swingDelay of [0, 5, 10, 15]) {
            for (const shot of ["DROP", "SMASH"] as const) {
              const state = campAgainstLift(
                lifter,
                x,
                y,
                jumpPhase,
                swingDelay,
                shot,
              );
              expect(
                state.rallyHits,
                JSON.stringify({ x, y, jumpPhase, swingDelay, shot }),
              ).toBe(1);
              expect(state.lastPoint).toMatchObject({
                winner: lifter,
                reason: "GROUND",
              });
              expect(badmintonStateSchema.safeParse(state).success).toBe(true);
            }
          }
        }
      }
    },
  );

  it.each([0, 1] as const)(
    "lets side %s retreat and return the lift instead of losing an unavoidable point",
    (lifter) => {
      let state = lift(lifter, 570_000, 400_000, 20);
      const receiver = other(lifter);
      for (
        let tick = 0;
        tick < 140 && state.phase === "RALLY" && state.rallyHits < 2;
        tick++
      ) {
        const receiverX = mirror(state.athletes[receiver].x, receiver);
        const retreat: Partial<BadmintonControls> = {
          move: receiverX > 200_000 ? (receiver === 0 ? -1 : 1) : 0,
          shot: state.shuttle.y > 320_000 ? "CLEAR" : "NONE",
        };
        const returning = { shot: tick === 0 ? "CLEAR" : "NONE" } as const;
        state = advance(
          state,
          lifter === 0 ? [returning, retreat] : [retreat, returning],
        );
      }
      expect(state.phase).toBe("RALLY");
      expect(state.rallyHits).toBe(2);
      expect(state.shuttle.lastHit).toBe(receiver);
      expect(mirror(state.athletes[receiver].x, receiver)).toBeLessThan(
        250_000,
      );
    },
  );
});

describe("height and placement distinguish the three shots", () => {
  it.each([0, 1] as const)(
    "preserves side %s's frozen 1.3.0 low drops",
    (side) => {
      for (const [x, y] of [
        [150_000, 280_000],
        [450_000, 280_000],
        [420_000, 435_000],
      ] as const) {
        let state = hit(
          contact(side, x, y),
          side,
          { shot: "DROP" },
          badmintonDefinitionV1_3_0,
        );
        expect(state.athletes[side].lastContact?.shot).toBe("DROP");
        let crossingY: number | null = null;
        const started = state.tick;
        while (state.phase === "RALLY" && state.tick - started < 100) {
          state = advance(state, [{}, {}], badmintonDefinitionV1_3_0);
          if (crossingY === null && mirror(state.shuttle.x, side) > COURT.netX)
            crossingY = state.shuttle.y;
        }
        expect(crossingY).toBeGreaterThan(
          COURT.netTop - PHYSICS.smashHeightAboveNet,
        );
        expect(crossingY).toBeLessThan(COURT.netTop - COURT.shuttleRadius);
        expect(state.lastPoint).toMatchObject({
          winner: side,
          reason: "GROUND",
        });
        expect(Math.abs(mirror(landingX(state), side) - 600_000)).toBeLessThan(
          2_000,
        );
      }
    },
  );

  it("uses available height for a deep clear without flying out of the ceiling", () => {
    const durations: number[] = [];
    for (const y of [280_000, 400_000, 470_000]) {
      let state = hit(contact(0, 420_000, y), 0, { shot: "CLEAR" });
      const started = state.tick;
      let apex = state.shuttle.y;
      while (state.phase === "RALLY" && state.tick - started < 130) {
        state = advance(state);
        apex = Math.min(apex, state.shuttle.y);
      }
      expect(apex).toBeGreaterThanOrEqual(40_000);
      expect(apex).toBeLessThan(60_000);
      expect(state.lastPoint).toMatchObject({ winner: 0, reason: "GROUND" });
      expect(Math.abs(landingX(state) - 870_000)).toBeLessThan(2_000);
      durations.push(state.tick - started);
    }
    expect(durations[0]).toBeLessThan(durations[1] ?? 0);
    expect(durations[1]).toBeLessThan(durations[2] ?? 0);
  });

  it.each([0, 1] as const)(
    "aims side %s's smash short, neutral or deep using existing direction intent",
    (side) => {
      const landings: number[] = [];
      for (const aim of [1, 0, -1]) {
        const move = (aim * (side === 0 ? 1 : -1)) as -1 | 0 | 1;
        let state = hit(contact(side), side, { move, shot: "SMASH" });
        expect(state.athletes[side].lastContact?.shot).toBe("SMASH");
        expect(state.shuttle.velocityY).toBeGreaterThan(0);
        for (let tick = 0; tick < 50 && state.phase === "RALLY"; tick++)
          state = advance(state);
        expect(state.lastPoint).toMatchObject({
          winner: side,
          reason: "GROUND",
        });
        landings.push(mirror(landingX(state), side));
      }
      for (const [index, target] of [670_000, 770_000, 870_000].entries())
        expect(Math.abs((landings[index] ?? 0) - target)).toBeLessThan(2_000);
    },
  );

  it.each([0, 1] as const)(
    "makes side %s's rising, behind, low and impossible-angle smash attempts defensive clears",
    (side) => {
      const rising = contact(side);
      rising.shuttle.velocityY = -2_000;
      const behind = contact(side, 430_000);
      behind.athletes[side].x = mirror(450_000, side);
      const belowHead = contact(side, 450_000, 290_000);
      const belowNetWindow = contact(side, 450_000, 310_000);
      belowNetWindow.athletes[side].y = 440_000;
      const grounded = contact(side, 450_000, 350_000);
      const impossibleAngle = contact(side, 170_000);
      for (const state of [
        rising,
        behind,
        belowHead,
        belowNetWindow,
        grounded,
        impossibleAngle,
      ]) {
        const next = hit(state, side, {
          move: side === 0 ? 1 : -1,
          shot: "SMASH",
        });
        expect(next.rallyHits).toBe(1);
        expect(next.athletes[side].lastContact?.shot).toBe("CLEAR");
        expect(next.athletes[side].cooldown).toBe(PHYSICS.swingCooldown);
      }
    },
  );

  it("starts smash recovery at contact and blocks a held follow-up until recovery ends", () => {
    const late = contact(0);
    late.tick = 8;
    Object.assign(late.athletes[0], {
      swingTicks: 3,
      cooldown: 16,
      swingShot: "SMASH",
      swingStartedTick: 1,
    });
    let state = hit(late, 0, { shot: "SMASH" });
    expect(state.athletes[0].lastContact?.shot).toBe("SMASH");
    expect(state.athletes[0].cooldown).toBe(36);
    expect(state.athletes[0].swingStartedTick).toBe(1);
    state = {
      ...state,
      shuttle: {
        x: 700_000,
        y: 80_000,
        velocityX: 0,
        velocityY: 0,
        lastHit: 1,
      },
    };
    for (let tick = 1; tick < 36; tick++) {
      state = hit(state, 0, { shot: "DROP" });
      expect(state.athletes[0].swingStartedTick).toBe(1);
    }
    const recovered = hit(state, 0, { shot: "DROP" });
    expect(recovered.athletes[0].swingStartedTick).toBe(recovered.tick);
    expect(recovered.athletes[0].swingShot).toBe("DROP");
    expect(badmintonStateSchema.safeParse(recovered).success).toBe(true);
  });
});

describe("drops leave time to move and an opportunity to attack", () => {
  it.each([0, 1] as const)(
    "restores side %s's 1.2.0 drop arc and forecourt landing from high and low contacts",
    (side) => {
      for (const [x, y] of [
        [150_000, 280_000],
        [450_000, 280_000],
        [450_000, 350_000],
        [420_000, 435_000],
      ] as const) {
        const before = contact(side, x, y);
        let state = hit(before, side, { shot: "DROP" });
        const old = hit(
          before,
          side,
          { shot: "DROP" },
          badmintonDefinitionV1_2_0,
        );
        expect(state.shuttle).toEqual(old.shuttle);
        expect(state.athletes[side].lastContact?.shot).toBe("DROP");
        const started = state.tick;
        while (state.phase === "RALLY" && state.tick - started < 100)
          state = advance(state);
        expect(state.tick - started).toBe(68);
        expect(state.lastPoint).toMatchObject({
          winner: side,
          reason: "GROUND",
        });
        expect(Math.abs(mirror(landingX(state), side) - 620_000)).toBeLessThan(
          2_000,
        );
      }
    },
  );

  function receiveDrop(
    side: BadmintonSide,
    receiverX: number,
    reactionTicks: number,
    definition: Definition,
  ) {
    const receiver = other(side);
    const before = contact(side, 450_000, 350_000);
    before.athletes[receiver].x = mirror(receiverX, side);
    let state = hit(before, side, { shot: "DROP" }, definition);
    for (
      let tick = 0;
      tick < 100 && state.phase === "RALLY" && state.rallyHits < 2;
      tick++
    ) {
      const controls: Partial<BadmintonControls> =
        tick < reactionTicks
          ? {}
          : {
              move:
                mirror(state.athletes[receiver].x, side) > 650_000
                  ? side === 0
                    ? -1
                    : 1
                  : 0,
              shot: "CLEAR",
            };
      state = hit(state, receiver, controls, definition);
    }
    return state;
  }

  it.each([0, 1] as const)(
    "lets side %s's opponent react from midcourt or the backcourt and run forward to return",
    (side) => {
      for (const receiverX of [760_000, 870_000]) {
        for (const reactionTicks of [12, 18]) {
          const state = receiveDrop(
            side,
            receiverX,
            reactionTicks,
            badmintonDefinition,
          );
          expect(state.phase).toBe("RALLY");
          expect(state.rallyHits).toBe(2);
          expect(state.shuttle.lastHit).toBe(other(side));
          expect(state.athletes[other(side)].lastContact?.shot).toBe("CLEAR");
        }
      }
      const old = receiveDrop(side, 870_000, 18, badmintonDefinitionV1_3_0);
      expect(old.rallyHits).toBe(1);
      expect(old.lastPoint).toMatchObject({ winner: side, reason: "GROUND" });
    },
  );

  it.each([0, 1] as const)(
    "allows a timed jumping smash against side %s's forecourt drop",
    (side) => {
      const receiver = other(side);
      for (const jumpTick of [4, 10, 16]) {
        const before = contact(side, 450_000, 350_000);
        before.athletes[receiver].x = mirror(590_000, side);
        let state = hit(before, side, { shot: "DROP" });
        for (
          let tick = 0;
          tick < 80 && state.phase === "RALLY" && state.rallyHits < 2;
          tick++
        ) {
          state = hit(state, receiver, {
            jump: tick === jumpTick,
            shot: state.shuttle.velocityY >= 0 ? "SMASH" : "NONE",
          });
        }
        expect(state.rallyHits).toBe(2);
        expect(state.athletes[receiver].lastContact?.shot).toBe("SMASH");
        expect(state.shuttle.velocityY).toBeGreaterThanOrEqual(0);
        expect(state.athletes[receiver].cooldown).toBe(PHYSICS.smashRecovery);
      }
    },
  );

  it.each([0, 1] as const)(
    "still faults side %s's late low drop into the net",
    (side) => {
      let state = hit(contact(side, 490_000, 470_000), side, { shot: "DROP" });
      expect(state.athletes[side].lastContact?.shot).toBe("DROP");
      for (let tick = 0; tick < 10 && state.phase === "RALLY"; tick++)
        state = advance(state);
      expect(state.lastPoint).toMatchObject({
        winner: other(side),
        reason: "NET",
      });
    },
  );
});
