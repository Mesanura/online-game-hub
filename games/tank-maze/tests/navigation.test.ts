import { describe, expect, it } from "vitest";
import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";
import {
  tankMazeDefinition as game,
  tankMazeDefinitionV1_0_0,
} from "../src/core/index.js";
import { clear, sweepWall } from "../src/core/geometry.js";
import { createMissileNavigator } from "../src/core/navigation.js";
import { generateArena } from "../src/core/map.js";
import type { Arena, Bullet } from "../src/core/schemas.js";

function arena(): Arena {
  return {
    cols: 6,
    rows: 6,
    width: 600000,
    height: 600000,
    cells: Array.from({ length: 36 }, (_, i) => i),
    walls: [
      { x: 0, y: 0, w: 600000, h: 8000 },
      { x: 0, y: 592000, w: 600000, h: 8000 },
      { x: 0, y: 0, w: 8000, h: 600000 },
      { x: 592000, y: 0, w: 8000, h: 600000 },
      { x: 196000, y: 0, w: 8000, h: 204000 },
    ],
  };
}

function scenario(vx = 2000, vy = 0) {
  const initial = game.createInitialState({
    config: { playerCount: 2, targetScore: 5, colors: [] },
    players: ["p0", "p1"].map(defineRealtimePlayerSlotId),
    rng: createRealtimeRng("missile-navigation"),
  });
  initial.state.arena = arena();
  initial.state.phase = "ACTIVE";
  initial.state.phaseTicks = 0;
  const [owner, target] = initial.state.tanks;
  if (!owner || !target) throw new Error("Missing navigation test players.");
  Object.assign(owner, { x: 550000, y: 550000 });
  Object.assign(target, { x: 250000, y: 150000 });
  initial.state.bullets = [
    {
      id: 1,
      owner: "p0",
      kind: "missile",
      x: 150000,
      y: 150000,
      vx,
      vy,
      radius: 3000,
      age: 180,
      life: 780,
      target: null,
      trail: [],
    },
  ];
  initial.state.nextId = 2;
  return initial;
}

function step(current: ReturnType<typeof scenario>, historical = false) {
  return (historical ? tankMazeDefinitionV1_0_0 : game).step({
    ...current,
    tick: current.state.tick,
    inputs: [],
  });
}

describe("missile navigation", () => {
  it("finds finite wall-safe routes across seeded mazes without consuming RNG", () => {
    for (let seed = 0; seed < 30; seed++) {
      const source = createRealtimeRng(`navigation-map-${seed}`);
      const { arena: map } = generateArena(source);
      const before = JSON.stringify(map);
      const first = map.cells[0];
      const last = map.cells.at(-1);
      if (first === undefined || last === undefined)
        throw new Error("Empty maze.");
      const center = (cell: number) => ({
        x: (cell % map.cols) * 100000 + 50000,
        y: Math.floor(cell / map.cols) * 100000 + 50000,
      });
      let position = center(first);
      const target = center(last);
      const navigate = createMissileNavigator(map);
      for (
        let hop = 0;
        hop < map.cells.length * 2 &&
        (position.x !== target.x || position.y !== target.y);
        hop++
      ) {
        const next = navigate({ ...position, radius: 3000 }, target);
        if (!next)
          throw new Error(`Reachable target has no route for seed ${seed}.`);
        expect(next).not.toEqual(position);
        expect(
          map.walls.every(
            (wall) =>
              sweepWall(
                position.x,
                position.y,
                next.x - position.x,
                next.y - position.y,
                3000,
                wall,
              ) === null,
          ),
        ).toBe(true);
        position = { ...next };
      }
      expect(position).toEqual(target);
      expect(JSON.stringify(map)).toBe(before);
      expect(source).toEqual(createRealtimeRng(`navigation-map-${seed}`));
    }
  });

  it("navigates successive corners through a one-cell-wide passage", () => {
    let current = scenario();
    current.state.arena.walls.push({
      x: 296000,
      y: 196000,
      w: 8000,
      h: 404000,
    });
    const target = current.state.tanks[1];
    if (!target) throw new Error("Missing navigation target.");
    target.x = 350000;
    for (let tick = 0; tick < 600 && current.state.tanks[1]?.alive; tick++) {
      current = step(current);
      const missile = current.state.bullets[0];
      if (missile)
        expect(
          clear(
            missile.x,
            missile.y,
            missile.radius,
            current.state.arena.walls,
          ),
        ).toBe(true);
    }
    expect(current.state.tanks[1]?.alive).toBe(false);
  });

  it("aims through a clear corridor and finds visible waypoints around an intervening wall", () => {
    const map = arena();
    const navigate = createMissileNavigator(map);
    const missile = { x: 150000, y: 150000, radius: 3000 };
    const visibleTarget = { x: 150000, y: 450000 };
    expect(navigate(missile, visibleTarget)).toEqual(visibleTarget);
    const hiddenTarget = { x: 250000, y: 150000 };
    const aim = navigate(missile, hiddenTarget);
    expect(aim?.y).toBeGreaterThan(204000);
    expect(aim).not.toEqual(hiddenTarget);
    if (!aim) throw new Error("Expected a navigable corridor.");
    expect(
      map.walls.every(
        (wall) =>
          sweepWall(
            missile.x,
            missile.y,
            aim.x - missile.x,
            aim.y - missile.y,
            missile.radius,
            wall,
          ) === null,
      ),
    ).toBe(true);
    expect(navigate(missile, hiddenTarget)).toEqual(aim);
  });

  it("does not cut corners and returns no route for disconnected regions", () => {
    const map = arena();
    map.walls.push({ x: 196000, y: 204000, w: 8000, h: 396000 });
    const navigate = createMissileNavigator(map);
    expect(
      navigate(
        { x: 150000, y: 150000, radius: 3000 },
        { x: 250000, y: 150000 },
      ),
    ).toBeNull();
  });

  it.each([
    [2000, 0],
    [0, 2000],
    [-2000, 0],
    [0, -2000],
  ])(
    "reaches a tank around a wall with initial velocity %s,%s without tunnelling",
    (vx, vy) => {
      let current = scenario(vx, vy);
      let passedEnd = false;
      for (let tick = 0; tick < 600 && current.state.tanks[1]?.alive; tick++) {
        const previous = current.state.bullets[0];
        current = step(current);
        const missile = current.state.bullets[0];
        if (missile) {
          passedEnd ||= missile.y > 207000;
          expect(
            clear(
              missile.x,
              missile.y,
              missile.radius,
              current.state.arena.walls,
            ),
          ).toBe(true);
          expect(
            Math.abs(Math.hypot(missile.vx, missile.vy) - 2000),
          ).toBeLessThan(1);
          if (
            previous &&
            !current.state.events.some((event) => event.kind === "bounce")
          ) {
            const angle = Math.acos(
              Math.max(
                -1,
                Math.min(
                  1,
                  (previous.vx * missile.vx + previous.vy * missile.vy) /
                    Math.hypot(previous.vx, previous.vy) /
                    Math.hypot(missile.vx, missile.vy),
                ),
              ),
            );
            expect(angle).toBeLessThanOrEqual(Math.PI / 120 + 0.001);
          }
        }
      }
      expect(passedEnd).toBe(true);
      expect(current.state.tanks[1]?.alive).toBe(false);
    },
  );

  it("preserves the historical direct pursuit and the three-second launch delay", () => {
    const initial = scenario();
    expect(step(initial, true).state.bullets[0]).toMatchObject({
      vx: 2000,
      vy: 0,
    });
    expect(step(initial).state.bullets[0]?.vy).toBeGreaterThan(0);
    const missile = initial.state.bullets[0];
    if (!missile) throw new Error("Missing navigation test missile.");
    missile.age = 179;
    expect(step(initial).state.bullets[0]).toMatchObject({
      vx: 2000,
      vy: 0,
      target: null,
      age: 180,
    });
  });

  it("replans for a closer target, clears dead targets and leaves caller State/RNG unchanged", () => {
    const initial = scenario();
    const frozen = JSON.stringify(initial);
    let current = step(initial);
    expect(current.state.bullets[0]?.target).toBe("p1");
    const owner = current.state.tanks[0];
    if (!owner) throw new Error("Missing navigation test owner.");
    Object.assign(owner, { x: 150000, y: 220000 });
    current = step(current);
    expect(current.state.bullets[0]?.target).toBe("p0");
    const killed = current.state.tanks[0];
    if (!killed) throw new Error("Missing navigation test owner.");
    killed.alive = false;
    current = step(current);
    expect(current.state.bullets[0]?.target).toBe("p1");
    expect(JSON.stringify(initial)).toBe(frozen);
    expect(current.rng).toEqual(initial.rng);
  });

  it("reconstructs each tick deterministically across JSON serialization", () => {
    let a = scenario();
    let b = JSON.parse(JSON.stringify(a)) as typeof a;
    for (let tick = 0; tick < 300; tick++) {
      a = step(a);
      b = step(JSON.parse(JSON.stringify(b)) as typeof b);
      expect(a).toEqual(b);
    }
    const view = game.projectView({
      state: a.state,
      viewer: { kind: "player", slotId: defineRealtimePlayerSlotId("p0") },
    });
    expect(view).not.toHaveProperty("navigation");
    expect(view.arena).not.toHaveProperty("cells");
    expect(
      view.bullets.every((bullet: Bullet) => !Object.hasOwn(bullet, "path")),
    ).toBe(true);
  });
});
