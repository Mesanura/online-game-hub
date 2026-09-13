import { describe, expect, it } from "vitest";
import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";
import {
  tankMazeDefinition as game,
  tankMazeDefinitionV1_2_0 as legacy,
} from "../src/core/index.js";
import { circleWall, RADIUS } from "../src/core/geometry.js";
import type { Bullet, Input, State } from "../src/core/schemas.js";

const slot = (index = 0) => defineRealtimePlayerSlotId(`p${index}`);
function create(count = 2) {
  const current = game.createInitialState({
    config: { playerCount: count, targetScore: 5, colors: [] },
    players: Array.from({ length: count }, (_, i) => slot(i)),
    rng: createRealtimeRng("tank-contact-regression"),
  });
  current.state.phase = "ACTIVE";
  current.state.arena = {
    width: 600000,
    height: 600000,
    cols: 6,
    rows: 6,
    cells: Array.from({ length: 36 }, (_, i) => i),
    walls: [
      { x: 0, y: 0, w: 600000, h: 8000 },
      { x: 0, y: 592000, w: 600000, h: 8000 },
      { x: 0, y: 0, w: 8000, h: 600000 },
      { x: 592000, y: 0, w: 8000, h: 600000 },
    ],
  };
  current.state.tanks.forEach((tank, i) => {
    tank.x = 250000 + i * 70000;
    tank.y = 250000;
    tank.angle = 0;
  });
  return current;
}
function tank(state: State, index = 0) {
  const value = state.tanks[index];
  if (!value) throw new Error("Missing test tank.");
  return value;
}
function step(
  current: ReturnType<typeof create>,
  inputs: Input[] = [],
  definition: typeof legacy = game,
) {
  return definition.step({
    ...current,
    tick: current.state.tick,
    inputs: inputs.map((input, i) => ({ slotId: slot(i), input })),
  });
}
const move = (value = 1, turn = 0): Input => ({
  type: "MOVE",
  move: value,
  turn,
});
function projected(state: State) {
  return game.projectView({
    state,
    viewer: { kind: "player", slotId: slot() },
  });
}
function legal(state: State) {
  for (const value of state.tanks) {
    expect(
      Number.isInteger(value.x) &&
        Number.isInteger(value.y) &&
        Number.isInteger(value.angle),
    ).toBe(true);
    expect(
      state.arena.walls.some((wall) =>
        circleWall(value.x, value.y, RADIUS, wall),
      ),
    ).toBe(false);
    for (const other of state.tanks)
      if (value !== other)
        expect(
          Math.hypot(value.x - other.x, value.y - other.y),
        ).toBeGreaterThanOrEqual(2 * RADIUS);
  }
}
const bullet = (props: Partial<Bullet> = {}): Bullet => ({
  id: 90,
  owner: "p1",
  kind: "normal",
  x: 290000,
  y: 250000,
  vx: -2500,
  vy: 0,
  age: 0,
  life: 780,
  radius: 3000,
  target: null,
  trail: [],
  ...props,
});

describe("wall sliding and alignment", () => {
  it.each(
    [0, 1, 2, 3].flatMap((side) =>
      [-1, 1].map((direction) => [side, direction]),
    ),
  )("slides and gradually aligns on wall %i, drive %i", (side, direction) => {
    let current = create();
    const positions = [
      [300000, 27000],
      [573000, 300000],
      [300000, 573000],
      [27000, 300000],
    ];
    const position = positions[side];
    if (!position) throw new Error("Missing wall position.");
    Object.assign(tank(current.state), {
      x: position[0],
      y: position[1],
      angle: (450 + side * 180 + (direction === -1 ? 360 : 0)) % 720,
    });
    const start = { ...tank(current.state) };
    const target = (360 + side * 180 + (direction === -1 ? 360 : 0)) % 720;
    for (let tick = 0; tick < 36; tick++) {
      const before = JSON.stringify(current);
      const oldAngle = tank(current.state).angle;
      const next = step(current, [move(direction)]);
      expect(JSON.stringify(current)).toBe(before);
      expect(step(JSON.parse(before), [move(direction)])).toEqual(next);
      current = next;
      const turned = Math.abs(
        ((tank(current.state).angle - oldAngle + 1080) % 720) - 360,
      );
      expect(turned).toBeLessThanOrEqual(3);
      if (tick === 0) expect(tank(current.state).angle).not.toBe(target);
      expect(projected(current.state).tanks[0]?.wallContact).toBe(true);
      legal(current.state);
    }
    expect(tank(current.state).angle).toBe(target);
    expect(
      Math.hypot(
        tank(current.state).x - start.x,
        tank(current.state).y - start.y,
      ),
    ).toBeGreaterThan(55000);
  });

  it("stops head-on without jitter, preserves manual steering, and releases contact", () => {
    let current = create();
    Object.assign(tank(current.state), { y: 27000, angle: 540 });
    for (let tick = 0; tick < 15; tick++) current = step(current, [move()]);
    expect(tank(current.state)).toMatchObject({
      x: 250000,
      y: 27000,
      angle: 540,
    });
    expect(projected(current.state).tanks[0]?.wallContact).toBe(true);
    current = step(current, [move(1, 1)]);
    expect(tank(current.state).angle).toBe(549);
    current = step(current, [move(-1)]);
    expect(tank(current.state).y).toBeGreaterThan(27000);
    expect(projected(current.state).tanks[0]?.wallContact).toBe(false);
    Object.assign(tank(current.state), { y: 27000, angle: 450 });
    current = step(current, [move()]);
    for (let tick = 0; tick < 31; tick++) current = step(current);
    expect(projected(current.state).tanks[0]?.wallContact).toBe(false);
    expect(
      projected(step(current, [move(0)]).state).tanks[0]?.wallContact,
    ).toBe(false);
  });

  it("resolves an inside corner without choosing an arbitrary turn or penetrating walls", () => {
    let current = create();
    Object.assign(tank(current.state), { x: 27000, y: 27000, angle: 450 });
    for (let tick = 0; tick < 60; tick++) current = step(current, [move()]);
    expect(tank(current.state)).toMatchObject({
      x: 27000,
      y: 27000,
      angle: 450,
    });
    legal(current.state);
  });

  it("uses round outside corners rather than blocking at the expanded square", () => {
    let current = create();
    current.state.arena.walls.push({
      x: 296000,
      y: 296000,
      w: 208000,
      h: 8000,
    });
    Object.assign(tank(current.state), { x: 280000, y: 281000, angle: 180 });
    current = step(current, [move()]);
    expect(tank(current.state).y).toBe(283000);
    for (let tick = 0; tick < 40; tick++) {
      current = step(current, [move()]);
      legal(current.state);
    }
    expect(tank(current.state).y).toBeGreaterThan(330000);
  });

  it("resolves wall-constrained push groups simultaneously in either participant order", () => {
    const initial = create(3);
    initial.state.tanks.forEach((value, i) =>
      Object.assign(value, { x: 300000 + i * 38000, y: 27000, angle: 630 }),
    );
    let current = initial;
    let reordered = JSON.parse(JSON.stringify(initial)) as typeof initial;
    reordered.state.tanks.reverse();
    reordered.state.arena.walls.reverse();
    for (let tick = 0; tick < 80; tick++) {
      current = step(current, [move()]);
      reordered = step(reordered, [move()]);
      legal(current.state);
      expect(
        [...reordered.state.tanks].sort((a, b) =>
          a.slotId.localeCompare(b.slotId),
        ),
      ).toEqual(current.state.tanks);
    }
  });

  it("does not let an approaching driver overlap a tank stopped at another wall", () => {
    let current = create();
    Object.assign(tank(current.state), { x: 531000, y: 250000, angle: 0 });
    Object.assign(tank(current.state, 1), { x: 573000, y: 250000, angle: 0 });
    for (let tick = 0; tick < 40; tick++) {
      current = step(current, [move(), move()]);
      legal(current.state);
    }
    expect(tank(current.state).x).toBe(535000);
  });
});

describe("moving shield interception", () => {
  it("reproduces the old moving-shield leak without changing historical rules", () => {
    let current = create();
    tank(current.state).shield = 600;
    current.state.bullets = [bullet({ x: 284000 })];
    for (let tick = 0; tick < 5; tick++)
      current = step(current, [move()], legacy);
    expect(tank(current.state).alive).toBe(false);
    expect(legacy.manifest.gameVersion).toBe("1.2.0");
  });

  it.each([
    ["normal", 2500, 3000],
    ["machine", 2500, 3000],
    ["missile", 2000, 3000],
    ["laser", 20000, 2000],
    ["shotgun", 3000, 2000],
  ] as const)(
    "blocks outside %s rounds while advancing, including exact boundary contact",
    (kind, speed, radius) => {
      for (const gap of [0, 1, 1000]) {
        let current = create();
        tank(current.state, 1).y = 450000;
        tank(current.state).shield = 600;
        current.state.bullets = [
          bullet({
            kind,
            radius,
            x: 250000 + 36000 + radius + gap,
            vx: -speed,
          }),
        ];
        for (let tick = 0; tick < 10; tick++) {
          current = step(current, [move()]);
          expect(tank(current.state).alive).toBe(true);
          const shell = current.state.bullets[0];
          expect(shell).toBeDefined();
          if (!shell) throw new Error("Missing reflected projectile.");
          expect(shell.vx).toBeGreaterThan(0);
          expect(Math.abs(Math.hypot(shell.vx, shell.vy) - speed)).toBeLessThan(
            2,
          );
          expect(
            Math.hypot(
              shell.x - tank(current.state).x,
              shell.y - tank(current.state).y,
            ),
          ).toBeGreaterThanOrEqual(36000 + radius);
        }
      }
    },
  );

  it("handles oblique shield movement and grazing incoming trajectories", () => {
    for (let angle = 0; angle < 720; angle += 45) {
      let current = create();
      Object.assign(tank(current.state), { shield: 600, angle });
      tank(current.state, 1).y = 450000;
      current.state.bullets = [bullet({ x: 289500, y: 256000 })];
      for (let tick = 0; tick < 20; tick++) {
        current = step(current, [move()]);
        expect(
          tank(current.state).alive,
          `heading ${angle}, tick ${tick}`,
        ).toBe(true);
      }
    }
  });

  it("keeps outside rounds blocked while the shield slides beside a wall", () => {
    for (const speed of [2000, 2500, 20000]) {
      for (let angle = 0; angle < 360; angle += 15) {
        let current = create();
        Object.assign(tank(current.state), {
          x: 300000,
          y: 27000,
          shield: 600,
        });
        tank(current.state, 1).y = 450000;
        const radians = (angle * Math.PI) / 180;
        const shell = bullet({
          x: 300000 + Math.round(Math.cos(radians) * 40000),
          y: 27000 + Math.round(Math.sin(radians) * 40000),
          vx: -Math.round(Math.cos(radians) * speed),
          vy: -Math.round(Math.sin(radians) * speed),
        });
        if (
          current.state.arena.walls.some((wall) =>
            circleWall(shell.x, shell.y, shell.radius, wall),
          )
        )
          continue;
        current.state.bullets = [shell];
        for (let tick = 0; tick < 20; tick++) {
          current = step(current, [move()]);
          expect(
            tank(current.state).alive,
            `speed ${speed}, angle ${angle}, tick ${tick}`,
          ).toBe(true);
        }
      }
    }
  });

  it("keeps inside ammunition dangerous and expires protection at the original tick", () => {
    for (const shield of [600, 1]) {
      let current = create();
      tank(current.state).shield = shield;
      current.state.bullets = [
        bullet({ x: shield === 1 ? 290000 : 275000, vx: -20000 }),
      ];
      current = step(current);
      expect(tank(current.state).alive).toBe(false);
    }
    const current = create();
    tank(current.state).shield = 600;
    current.state.arena.walls.push({
      x: 274000,
      y: 200000,
      w: 8000,
      h: 100000,
    });
    expect(tank(step(current, [{ type: "FIRE" }]).state).alive).toBe(false);
  });

  it("allows a muzzle shot to leave the enlarged shield and reflects its return", () => {
    let current = create();
    tank(current.state).shield = 600;
    tank(current.state, 1).y = 450000;
    current.state.arena.walls.push({
      x: 340000,
      y: 200000,
      w: 8000,
      h: 100000,
    });
    current = step(current, [{ type: "FIRE" }]);
    expect(current.state.bullets[0]?.x).toBe(281500);
    let reflected = false;
    for (let tick = 0; tick < 65; tick++) {
      const previous = current.state.bullets[0];
      current = step(current);
      expect(tank(current.state).alive).toBe(true);
      if (
        previous &&
        previous.vx < 0 &&
        (current.state.bullets[0]?.vx ?? 0) > 0
      )
        reflected = true;
    }
    expect(reflected).toBe(true);
    const view = projected(current.state);
    expect(view.tanks[0]?.shieldRadius).toBe(36000);
    expect(view.tanks[0]).not.toHaveProperty("move");
    expect(view.tanks[0]).not.toHaveProperty("lease");
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
