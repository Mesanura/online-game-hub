import { describe, it, expect } from "vitest";
import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";
import {
  tankMazeDefinition as game,
  tankMazeDefinitionV1_0_0,
  inputSchema,
} from "../src/core/index.js";
import { generateArena } from "../src/core/map.js";
import type { Input, Bullet } from "../src/core/schemas.js";
const create = (count = 2) =>
  game.createInitialState({
    config: { playerCount: count, targetScore: 5, colors: [] },
    players: Array.from({ length: count }, (_, i) =>
      defineRealtimePlayerSlotId("p" + i),
    ),
    rng: createRealtimeRng("tank-test"),
  });
function active(count = 2) {
  const initial = create(count);
  initial.state.phase = "ACTIVE";
  initial.state.arena.walls = [
    { x: 0, y: 0, w: 800000, h: 8000 },
    { x: 0, y: 592000, w: 800000, h: 8000 },
    { x: 0, y: 0, w: 8000, h: 600000 },
    { x: 792000, y: 0, w: 8000, h: 600000 },
  ];
  initial.state.arena.width = 800000;
  initial.state.arena.height = 600000;
  initial.state.arena.cols = 8;
  initial.state.arena.rows = 6;
  initial.state.arena.cells = Array.from({ length: 48 }, (_, i) => i);
  initial.state.tanks.forEach((t, i) => {
    t.x = 100000 + i * 70000;
    t.y = 300000;
    t.angle = 0;
  });
  return initial;
}
function step(
  current: ReturnType<typeof create>,
  inputs: {
    slotId: string;
    input: Input;
  }[] = [],
) {
  return game.step({
    state: current.state,
    tick: current.state.tick,
    rng: current.rng,
    inputs: inputs.map((i) => ({
      ...i,
      slotId: defineRealtimePlayerSlotId(i.slotId),
    })),
  });
}
const bullet = (props: Partial<Bullet> = {}): Bullet => ({
  id: 90,
  owner: "p0",
  kind: "normal",
  x: 300000,
  y: 100000,
  vx: 2500,
  vy: 0,
  age: 0,
  life: 780,
  radius: 3000,
  target: null,
  trail: [],
  ...props,
});
describe("tank maze authoritative rules", () => {
  it.each([-1, 1])(
    "rotates a full circle in 75 ticks in direction %s",
    (turn) => {
      for (let offset = 0; offset < 5; offset++) {
        let current = active();
        current.state.tick = offset;
        const start = required(current.state.tanks[0]).angle;
        for (let tick = 1; tick <= 75; tick++) {
          current = step(current, [
            { slotId: "p0", input: { type: "MOVE", move: 0, turn } },
          ]);
          expect(Number.isInteger(required(current.state.tanks[0]).angle)).toBe(
            true,
          );
          if (tick % 15 === 0)
            expect(required(current.state.tanks[0]).angle).toBe(
              (start + turn * tick * 9.6 + 720) % 720,
            );
        }
        expect(required(current.state.tanks[0]).angle).toBe(start);
      }
    },
  );
  it("preserves the previous rotation rate for historical games", () => {
    const current = active();
    const result = tankMazeDefinitionV1_0_0.step({
      ...current,
      tick: current.state.tick,
      inputs: [
        {
          slotId: defineRealtimePlayerSlotId("p0"),
          input: { type: "MOVE", move: 0, turn: 1 },
        },
      ],
    });
    expect(result.state.tanks[0]?.angle).toBe(5);
    expect(tankMazeDefinitionV1_0_0.manifest.gameVersion).toBe("1.0.0");
    expect(game.manifest.gameVersion).toBe("1.2.0");
  });
  it("refreshes the independent shield and replaces only the special weapon slot", () => {
    let c = active();
    const t = required(c.state.tanks[0]);
    t.shield = 100;
    t.weapon = "machine";
    t.ammo = 7;
    c.state.pickups = [{ id: 99, kind: "laser", x: t.x, y: t.y, life: 1200 }];
    c = step(c);
    expect(c.state.tanks[0]).toMatchObject({
      weapon: "laser",
      ammo: 1,
      shield: 99,
    });
    c.state.pickups = [{ id: 100, kind: "shield", x: t.x, y: t.y, life: 1200 }];
    c = step(c);
    expect(c.state.tanks[0]).toMatchObject({
      weapon: "laser",
      ammo: 1,
      shield: 600,
    });
    for (let i = 0; i < 600; i++) c = step(c);
    expect(c.state.tanks[0]?.shield).toBe(0);
  });
  it.each([
    ["normal", 780],
    ["machine", 780],
    ["missile", 780],
    ["laser", 60],
    ["shotgun", 180],
  ] as const)("expires %s at its exact lifetime", (kind, life) => {
    const c = active();
    c.state.bullets = [bullet({ kind, life, age: life - 1 })];
    expect(step(c).state.bullets).toHaveLength(0);
  });
  it("sweeps a fast laser against a thin wall and retains a clipped reflected trail", () => {
    const c = active();
    c.state.arena.walls.push({ x: 416000, y: 50000, w: 8000, h: 100000 });
    c.state.bullets = [
      bullet({
        kind: "laser",
        x: 400000,
        y: 100000,
        vx: 20000,
        radius: 2000,
        life: 60,
        trail: [{ x: 400000, y: 100000 }],
      }),
    ];
    const b = required(step(c).state.bullets[0]);
    expect(b.vx).toBeLessThan(0);
    expect(b.trail.every((p) => p.x <= 414000)).toBe(true);
  });
  it("spawns after five seconds, bounds the interval and disables new pickups during LAST", () => {
    let c = create();
    c.state.phase = "ACTIVE";
    for (let i = 0; i < 299; i++) c = step(c);
    expect(c.state.pickups).toHaveLength(0);
    c = step(c);
    expect(c.state.pickups).toHaveLength(1);
    expect(c.state.nextPickup).toBeGreaterThanOrEqual(300);
    expect(c.state.nextPickup).toBeLessThanOrEqual(480);
    c.state.phase = "LAST";
    c.state.phaseTicks = 240;
    required(c.state.tanks[1]).alive = false;
    c.state.nextPickup = 1;
    c = step(c);
    expect(c.state.pickups).toHaveLength(1);
    expect(c.state.nextPickup).toBe(1);
  });
  it.each([2, 3, 8])(
    "initializes %i distinct players, serializes and hides internals",
    (count) => {
      const a = create(count),
        b = create(count);
      expect(a).toEqual(b);
      expect(a.state.tanks).toHaveLength(count);
      expect(JSON.parse(JSON.stringify(a))).toEqual(a);
      const view = game.projectView({
        state: a.state,
        viewer: { kind: "player", slotId: defineRealtimePlayerSlotId("p0") },
      });
      expect(view).not.toHaveProperty("nextId");
      expect(view.arena).not.toHaveProperty("cells");
      expect(view.tanks[0]).not.toHaveProperty("lease");
    },
  );
  it("rejects invalid intent, actor fields and single-player config", () => {
    expect(inputSchema.safeParse({ type: "FIRE", actor: "p1" }).success).toBe(
      false,
    );
    expect(
      inputSchema.safeParse({ type: "MOVE", move: 2, turn: 0 }).success,
    ).toBe(false);
    expect(() => create(1)).toThrow();
  });
  it("preparation lasts exactly 180 ticks and inputs do not move tanks", () => {
    let c = create();
    const x = required(c.state.tanks[0]).x;
    for (let i = 0; i < 179; i++)
      c = step(c, [
        { slotId: "p0", input: { type: "MOVE", move: 1, turn: 0 } },
      ]);
    expect(c.state.phase).toBe("PREPARE");
    expect(required(c.state.tanks[0]).x).toBe(x);
    c = step(c);
    expect(c.state.phase).toBe("ACTIVE");
  });
  it("retains five same-tick fire events, independent expiry releases capacity", () => {
    let c = active();
    required(c.state.tanks[1]).y = 500000;
    c = step(
      c,
      Array.from({ length: 6 }, () => ({
        slotId: "p0",
        input: { type: "FIRE" as const },
      })),
    );
    expect(c.state.bullets).toHaveLength(5);
    required(c.state.bullets[0]).age = 779;
    c = step(c);
    expect(c.state.bullets).toHaveLength(4);
    c = step(c, [{ slotId: "p0", input: { type: "FIRE" } }]);
    expect(c.state.bullets).toHaveLength(5);
  });
  it("does not mutate inputs and releases movement after its lease", () => {
    let c = active();
    const frozen = JSON.stringify(c);
    const n = step(c, [
      { slotId: "p0", input: { type: "MOVE", move: 1, turn: 0 } },
    ]);
    expect(JSON.stringify(c)).toBe(frozen);
    expect(required(n.state.tanks[0]).x).toBeGreaterThan(
      required(c.state.tanks[0]).x,
    );
    c = n;
    for (let i = 0; i < 40; i++) c = step(c);
    const x = required(c.state.tanks[0]).x;
    c = step(c);
    expect(required(c.state.tanks[0]).x).toBe(x);
  });
  it("pushes a stationary chain and blocks the whole group at a wall", () => {
    let c = active(3);
    c.state.tanks.forEach((t, i) => {
      t.x = 100000 + 38000 * i;
    });
    c = step(c, [{ slotId: "p0", input: { type: "MOVE", move: 1, turn: 0 } }]);
    expect(c.state.tanks.map((t) => t.x)).toEqual([102000, 140000, 178000]);
    c.state.arena.walls.push({ x: 196501, y: 200000, w: 8000, h: 200000 });
    const positions = c.state.tanks.map((t) => t.x);
    c = step(c);
    expect(c.state.tanks.map((t) => t.x)).toEqual(positions);
  });
  it("opposing push cancels without slot priority", () => {
    const c = active();
    required(c.state.tanks[1]).x = 138000;
    required(c.state.tanks[1]).angle = 360;
    const n = step(c, [
      { slotId: "p0", input: { type: "MOVE", move: 1, turn: 0 } },
      { slotId: "p1", input: { type: "MOVE", move: 1, turn: 0 } },
    ]);
    expect(n.state.tanks.map((t) => t.x)).toEqual([100000, 138000]);
  });
  it("reflects all outside projectiles but does not protect a projectile inside the shield", () => {
    for (const kind of [
      "normal",
      "laser",
      "missile",
      "machine",
      "shotgun",
    ] as const) {
      const c = active();
      required(c.state.tanks[0]).shield = 600;
      c.state.bullets = [bullet({ kind, x: 135000, y: 300000, vx: -10000 })];
      const n = step(c);
      expect(required(n.state.tanks[0]).alive).toBe(true);
      expect(required(n.state.bullets[0]).vx).toBeGreaterThan(0);
    }
    const c = active();
    required(c.state.tanks[0]).shield = 600;
    c.state.bullets = [bullet({ x: 125000, y: 300000, vx: -10000 })];
    expect(required(step(c).state.tanks[0]).alive).toBe(false);
  });
  it("shooting against a close wall can kill the shooter inside its shield", () => {
    let c = active();
    required(c.state.tanks[0]).shield = 600;
    c.state.arena.walls.push({ x: 124000, y: 200000, w: 8000, h: 200000 });
    c = step(c, [{ slotId: "p0", input: { type: "FIRE" } }]);
    expect(required(c.state.tanks[0]).alive).toBe(false);
  });
  it("missiles wait three seconds, target nearest including owner and switch", () => {
    const c = active();
    c.state.bullets = [
      bullet({
        kind: "missile",
        x: 300000,
        y: 400000,
        age: 179,
        vx: 0,
        vy: 2000,
      }),
    ];
    let n = step(c);
    expect(required(n.state.bullets[0]).target).toBe(null);
    n = step(n);
    expect(required(n.state.bullets[0]).target).toBe("p1");
    required(n.state.tanks[0]).x = 300000;
    required(n.state.tanks[0]).y = 460000;
    n = step(n);
    expect(required(n.state.bullets[0]).target).toBe("p0");
  });
  it("machine and shotgun ammunition bypass normal limits", () => {
    for (const [weapon, ammo, count] of [
      ["machine", 10, 10],
      ["shotgun", 1, 20],
    ] as const) {
      let c = active();
      required(c.state.tanks[1]).y = 500000;
      required(c.state.tanks[0]).weapon = weapon;
      required(c.state.tanks[0]).ammo = ammo;
      c = step(
        c,
        Array.from({ length: ammo }, () => ({
          slotId: "p0",
          input: { type: "FIRE" as const },
        })),
      );
      expect(c.state.bullets).toHaveLength(count);
      expect(required(c.state.tanks[0]).weapon).toBe("normal");
      c = step(
        c,
        Array.from({ length: 5 }, () => ({
          slotId: "p0",
          input: { type: "FIRE" as const },
        })),
      );
      expect(c.state.bullets.filter((b) => b.kind === "normal")).toHaveLength(
        5,
      );
    }
  });
  it("last survivor gets one point after exactly four seconds", () => {
    let c = active();
    required(c.state.tanks[1]).alive = false;
    c = step(c);
    expect(c.state.phaseTicks).toBe(240);
    for (let i = 0; i < 239; i++) c = step(c);
    expect(required(c.state.tanks[0]).score).toBe(0);
    c = step(c);
    expect(required(c.state.tanks[0]).score).toBe(1);
    expect(c.state.phase).toBe("PREPARE");
    expect(c.state.bout).toBe(2);
  });
  it("simultaneous deaths and death during countdown score nobody", () => {
    let c = active();
    required(c.state.tanks[1]).alive = false;
    c = step(c);
    c.state.bullets = [
      bullet({
        x: required(c.state.tanks[0]).x,
        y: required(c.state.tanks[0]).y,
      }),
    ];
    c = step(c);
    expect(c.state.tanks.map((t) => t.score)).toEqual([0, 0]);
    expect(c.state.phase).toBe("PREPARE");
  });
  it("times out at 120 seconds, but preserves an existing last-survivor countdown", () => {
    const c = active();
    c.state.elapsed = 7199;
    expect(step(c).state.phase).toBe("PREPARE");
    c.state.phase = "LAST";
    c.state.phaseTicks = 20;
    required(c.state.tanks[1]).alive = false;
    expect(step(c).state.phaseTicks).toBe(19);
  });
  it("score target ends the match; resignation is permanent and can complete it", () => {
    let c = active();
    required(c.state.tanks[0]).score = 4;
    required(c.state.tanks[1]).alive = false;
    c.state.phase = "LAST";
    c.state.phaseTicks = 1;
    expect(step(c).state.outcome).toMatchObject({
      winnerSlotId: "p0",
      reason: "SCORE",
    });
    c = active(3);
    c = step(c, [{ slotId: "p0", input: { type: "RESIGN" } }]);
    expect(required(c.state.tanks[0]).resigned).toBe(true);
    c = step(c, [{ slotId: "p1", input: { type: "RESIGN" } }]);
    expect(c.state.outcome).toMatchObject({
      winnerSlotId: "p2",
      reason: "RESIGNATION",
    });
  });
  it("generates bounded maps with at least 85% reachable cells across seeds", () => {
    const sizes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { arena } = generateArena(createRealtimeRng("map-" + i));
      expect(arena.cells.length).toBeGreaterThanOrEqual(
        Math.ceil(arena.cols * arena.rows * 0.85),
      );
      expect(arena.cols).toBeGreaterThanOrEqual(6);
      expect(arena.cols).toBeLessThanOrEqual(10);
      expect(arena.rows).toBeGreaterThanOrEqual(5);
      expect(arena.rows).toBeLessThanOrEqual(7);
      expect(arena.width).toBe(arena.cols * 100000);
      expect(generateArena(createRealtimeRng("map-" + i)).arena).toEqual(arena);
      sizes.add(arena.cols + "x" + arena.rows);
    }
    expect(sizes.size).toBeGreaterThan(10);
    expect(
      new Set([...sizes].map((size) => Number(size.split("x")[0]))),
    ).toEqual(new Set([6, 7, 8, 9, 10]));
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required tank value is missing.");
  return value;
}
