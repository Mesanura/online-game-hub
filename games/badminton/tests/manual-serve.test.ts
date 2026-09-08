import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";
import { describe, expect, it } from "vitest";
import {
  COURT,
  PHYSICS,
  createInitialState,
  step,
  projectView,
  badmintonStateSchema,
  type BadmintonState,
  type BadmintonControls,
  type BadmintonSide,
} from "../src/core/index.js";

const players = [
  defineRealtimePlayerSlotId("left"),
  defineRealtimePlayerSlotId("right"),
] as const;
const rng = createRealtimeRng("manual-serve");
const neutral = { move: 0, jump: false, serve: false, shot: "NONE" } as const;
function initial(side: BadmintonSide = 0): BadmintonState {
  const state = structuredClone(
    createInitialState({ config: { targetScore: 7 }, players, rng }).state,
  );
  state.server = side;
  return state;
}
function advance(
  state: BadmintonState,
  controls: Partial<BadmintonControls> = {},
  side: BadmintonSide = state.server,
) {
  return step({
    state,
    tick: state.tick,
    rng,
    inputs: [
      {
        slotId: players[side],
        input: { type: "CONTROL", ...neutral, ...controls },
      },
    ],
  }).state;
}

describe("manual serving and foot-aligned boundaries", () => {
  it.each([0, 1] as const)(
    "plants side %s's front foot on its serve line, including jumping and held movement",
    (side) => {
      let state = initial(side);
      const facing = side === 0 ? 1 : -1;
      const line = side === 0 ? COURT.leftServeLine : COURT.rightServeLine;
      for (let tick = 0; tick < 100; tick++)
        state = advance(state, { move: facing });
      expect(state.athletes[side].x + facing * COURT.frontFootOffset).toBe(
        line,
      );
      expect(state.athletes[side].moving).toBe(false);
      state = advance(state, { move: facing, jump: true });
      expect(state.athletes[side].y).toBeLessThan(COURT.ground);
      for (let tick = 0; tick < 50; tick++)
        state = advance(state, { move: facing, jump: true });
      expect(state.athletes[side]).toMatchObject({
        y: COURT.ground,
        moving: false,
      });
      const view = projectView({
        state,
        viewer: { kind: "player", slotId: players[side] },
      });
      expect(view.athletes[side].x + facing * view.court.frontFootOffset).toBe(
        line,
      );
      for (let tick = 0; tick < 100; tick++)
        state = advance(state, { move: side === 0 ? -1 : 1 });
      expect(state.athletes[side].x).toBe(
        side === 0 ? COURT.leftLine : COURT.rightLine,
      );
    },
  );

  it.each([0, 1] as const)(
    "lets side %s serve in the air and releases on the contact tick",
    (side) => {
      let state = advance(initial(side), { jump: true });
      state = advance(state, {
        jump: true,
        move: side === 0 ? 1 : -1,
        serve: true,
        shot: "SMASH",
      });
      const started = state.tick;
      const launchX = state.athletes[side].x;
      for (let age = 1; age < PHYSICS.serveContactTick; age++) {
        state = advance(state, {
          jump: true,
          move: side === 0 ? 1 : -1,
          serve: true,
        });
        expect(badmintonStateSchema.safeParse(state).success).toBe(true);
      }
      expect(state.phase).toBe("RALLY");
      expect(state.athletes[side].x).not.toBe(launchX);
      expect(state.athletes[side].lastContact).toMatchObject({
        tick: started + 5,
        shot: "CLEAR",
      });
      expect(state.shuttle.y).toBe(
        state.athletes[side].y - PHYSICS.serveHandOffsetY,
      );
      expect(state.shuttle.velocityY).toBeLessThan(0);
      expect(state.athletes[side]).toMatchObject({
        swingKind: "SERVE",
        swingStartedTick: started,
      });
    },
  );

  it("never carries a held serve into the next rally", () => {
    let state = initial();
    while (state.rally === 1) state = advance(state, { serve: true });
    for (let tick = 0; tick < 300; tick++)
      state = advance(state, { serve: true });
    expect(state).toMatchObject({
      phase: "SERVE",
      rallyHits: 0,
      scores: [1, 0],
    });
    state = advance(state);
    expect(advance(state, { serve: true }).phase).toBe("SERVING");
  });

  it("allows full receiver movement and expands the server's range after release", () => {
    let state = initial();
    for (let tick = 0; tick < 100; tick++)
      state = advance(state, { move: -1 }, 1);
    expect(state.athletes[1].x).toBe(535_000);
    for (let tick = 0; tick < 100; tick++)
      state = advance(state, { move: 1 }, 0);
    for (let tick = 0; tick < 6; tick++)
      state = advance(state, { serve: true, move: 1 }, 0);
    expect(advance(state, { move: 1 }, 0).athletes[0].x).toBeGreaterThan(
      340_000,
    );
  });
});

describe("stroke selection and drag", () => {
  it.each([0, 1] as const)(
    "uses side %s's relative waist and preserves low clear/drop differences",
    (side) => {
      const velocities: number[] = [];
      for (const shot of ["CLEAR", "DROP", "SMASH"] as const) {
        const state = initial(side);
        state.phase = "RALLY";
        state.athletes[side].y = 390_000;
        state.shuttle = {
          x: state.athletes[side].x + (side === 0 ? 40_000 : -40_000),
          y: 320_000,
          velocityX: side === 0 ? -100 : 100,
          velocityY: 0,
          lastHit: side === 0 ? 1 : 0,
        };
        const next = advance(state, { shot }, side);
        expect(next.athletes[side].swingKind).toBe("UNDERHAND");
        expect(next.athletes[side].swingShot).toBe(
          shot === "SMASH" ? "CLEAR" : shot,
        );
        expect(next.shuttle.velocityY).toBeLessThan(0);
        velocities.push(next.shuttle.velocityY);
      }
      expect(velocities[0]).toBe(velocities[2]);
      expect(velocities[1]).not.toBe(velocities[0]);
    },
  );

  it("does not restart the swing when a later tick makes contact", () => {
    let state = initial();
    state.phase = "RALLY";
    state.shuttle = {
      x: 280_000,
      y: 307_000,
      velocityX: -100,
      velocityY: 1000,
      lastHit: 1,
    };
    state = advance(state, { shot: "CLEAR" });
    const start = state.athletes[0].swingStartedTick;
    expect(state.rallyHits).toBe(0);
    for (let tick = 0; tick < 8 && state.rallyHits === 0; tick++)
      state = advance(state, { shot: "CLEAR" });
    expect(state.rallyHits).toBe(1);
    expect(state.athletes[0].swingStartedTick).toBe(start);
    expect(state.athletes[0].swingTicks).toBeLessThan(10);
  });

  it("slows horizontal flight and steepens descent while preserving mirrored landings", () => {
    const landings: number[] = [];
    for (const side of [0, 1] as const) {
      let state = initial(side);
      state.phase = "RALLY";
      state.athletes[side].x = side === 0 ? 410_000 : 590_000;
      state.athletes[side].y = 390_000;
      state.shuttle = {
        x: side === 0 ? 450_000 : 550_000,
        y: 280_000,
        velocityX: side === 0 ? -100 : 100,
        velocityY: 0,
        lastHit: side === 0 ? 1 : 0,
      };
      state = advance(state, { shot: "CLEAR" });
      const launchSpeed = Math.abs(state.shuttle.velocityX);
      let lastSlope = 0;
      let descent = 0;
      while (state.phase === "RALLY") {
        const next = advance(state);
        if (next.phase === "RALLY" && next.shuttle.velocityY > 0) {
          const slope =
            next.shuttle.velocityY / Math.abs(next.shuttle.velocityX);
          expect(slope).toBeGreaterThan(lastSlope);
          lastSlope = slope;
          descent++;
        }
        if (next.phase !== "RALLY")
          expect(Math.abs(state.shuttle.velocityX)).toBeLessThan(
            launchSpeed * 0.2,
          );
        state = next;
      }
      expect(descent).toBeGreaterThan(30);
      expect(state.lastPoint?.reason).toBe("GROUND");
      landings.push(state.lastPoint?.x ?? 0);
    }
    expect(Math.abs((landings[0] ?? 0) - 830_000)).toBeLessThan(2000);
    expect((landings[0] ?? 0) + (landings[1] ?? 0)).toBe(COURT.width);
  });
});
