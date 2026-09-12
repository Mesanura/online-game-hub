import { describe, expect, it } from "vitest";
import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
  nextRealtimeInt,
} from "@online-game-hub/realtime-game-sdk";
import {
  tankMazeDefinition as game,
  tankMazeDefinitionV1_0_0,
  tankMazeDefinitionV1_1_0,
} from "../src/core/index.js";
import { generateArena } from "../src/core/map.js";
import type { Input, State } from "../src/core/schemas.js";

const minimumSeed = "tank-map-v1.2-2";
const slot = (index: number) => defineRealtimePlayerSlotId(`p${index}`);
function create(count = 2, seed = minimumSeed, definition = game) {
  return definition.createInitialState({
    config: { playerCount: count, targetScore: 5, colors: [] },
    players: Array.from({ length: count }, (_, i) => slot(i)),
    rng: createRealtimeRng(seed),
  });
}
function open(count = 2) {
  const current = create(count);
  current.state.phase = "ACTIVE";
  current.state.arena.walls = current.state.arena.walls.slice(0, 4);
  current.state.tanks.forEach((tank, i) => {
    tank.x = 100000 + i * 70000;
    tank.y = 250000;
    tank.angle = 0;
  });
  return current;
}
function step(
  current: ReturnType<typeof create>,
  input: Input | null = null,
  index = 0,
  definition = game,
) {
  return definition.step({
    ...current,
    tick: current.state.tick,
    inputs: input === null ? [] : [{ slotId: slot(index), input }],
  });
}
function tank(state: State, index = 0) {
  const value = state.tanks[index];
  if (value === undefined) throw new Error("Missing test tank.");
  return value;
}

describe("tank maze 1.2.0 movement", () => {
  it.each([
    [0, 2000, 0],
    [180, 0, 2000],
    [360, -2000, 0],
    [540, 0, -2000],
  ])("moves equally forward and backward at heading %i", (angle, dx, dy) => {
    const current = open();
    const start = tank(current.state);
    start.angle = angle;
    for (const move of [-1, 1]) {
      const moved = tank(step(current, { type: "MOVE", move, turn: 0 }).state);
      expect([moved.x - start.x, moved.y - start.y]).toEqual([
        move * dx || 0,
        move * dy || 0,
      ]);
    }
  });

  it("keeps integer motion and symmetric speed at all 720 headings", () => {
    const current = open();
    for (let angle = 0; angle < 720; angle++) {
      const start = tank(current.state);
      start.angle = angle;
      const forward = tank(
        step(current, { type: "MOVE", move: 1, turn: 0 }).state,
      );
      const reverse = tank(
        step(current, { type: "MOVE", move: -1, turn: 0 }).state,
      );
      for (const moved of [forward, reverse]) {
        expect(Number.isInteger(moved.x) && Number.isInteger(moved.y)).toBe(
          true,
        );
        expect(
          Math.abs(Math.hypot(moved.x - start.x, moved.y - start.y) - 2000),
        ).toBeLessThan(1);
      }
      // Existing Math.round quantization can differ by one unit at a half-step.
      expect(Math.abs(forward.x + reverse.x - 2 * start.x)).toBeLessThanOrEqual(
        1,
      );
      expect(Math.abs(forward.y + reverse.y - 2 * start.y)).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it.each([-1, 1])(
    "pushes a chain at speed 2000 and stops at walls (%i)",
    (move) => {
      let current = open(3);
      current.state.tanks.forEach((value, i) => {
        value.x = 100000 + 38000 * i;
      });
      current = step(
        current,
        { type: "MOVE", move, turn: 0 },
        move === 1 ? 0 : 2,
      );
      expect(current.state.tanks.map((value) => value.x)).toEqual(
        [100000, 138000, 176000].map((x) => x + move * 2000),
      );
      current.state.arena.walls.push({
        x:
          move === 1
            ? tank(current.state, 2).x + 19501
            : tank(current.state).x - 27501,
        y: 200000,
        w: 8000,
        h: 100000,
      });
      expect(step(current).state.tanks.map((value) => value.x)).toEqual(
        current.state.tanks.map((value) => value.x),
      );
    },
  );

  it("cancels opposed forward and reverse drivers without drift", () => {
    const current = open();
    tank(current.state, 1).x = 138000;
    const next = game.step({
      ...current,
      tick: current.state.tick,
      inputs: [
        { slotId: slot(0), input: { type: "MOVE", move: 1, turn: 0 } },
        { slotId: slot(1), input: { type: "MOVE", move: -1, turn: 0 } },
      ],
    });
    expect(next.state.tanks.map((value) => value.x)).toEqual([100000, 138000]);
  });

  it.each([tankMazeDefinitionV1_0_0, tankMazeDefinitionV1_1_0])(
    "preserves slower reverse motion for $manifest.gameVersion records",
    (definition) => {
      const current = open();
      expect(
        tank(
          step(current, { type: "MOVE", move: -1, turn: 0 }, 0, definition)
            .state,
        ).x,
      ).toBe(98917);
      expect(
        tank(
          step(current, { type: "MOVE", move: 1, turn: 0 }, 0, definition)
            .state,
        ).x,
      ).toBe(102000);
    },
  );
});

describe("tank maze 1.2.0 map distribution", () => {
  it("covers every integer roll, including weight boundaries, using the seeded RNG", () => {
    const columns = new Map<number, string>();
    const rows = new Map<number, string>();
    for (let i = 0; i < 2000 && (columns.size < 100 || rows.size < 100); i++) {
      const seed = `tank-map-v1.2-${i}`;
      const first = nextRealtimeInt(createRealtimeRng(seed), 100);
      const second = nextRealtimeInt(first.next, 100);
      columns.set(first.value, seed);
      rows.set(second.value, seed);
    }
    expect([columns.size, rows.size]).toEqual([100, 100]);
    for (const [axis, witnesses, buckets] of [
      [
        "cols",
        columns,
        [
          [0, 29, 6],
          [30, 59, 7],
          [60, 79, 8],
          [80, 94, 9],
          [95, 99, 10],
        ],
      ],
      [
        "rows",
        rows,
        [
          [0, 29, 5],
          [30, 79, 6],
          [80, 99, 7],
        ],
      ],
    ] as const) {
      const frequencies = new Map<number, number>();
      for (const [roll, seed] of witnesses) {
        const expected = buckets.find(
          ([lower, upper]) => roll >= lower && roll <= upper,
        )?.[2];
        const source = createRealtimeRng(seed);
        const saved = JSON.stringify(source);
        const actual = generateArena(source);
        expect(actual.arena[axis], `${axis}, roll ${roll}, seed ${seed}`).toBe(
          expected,
        );
        expect(JSON.stringify(source)).toBe(saved);
        expect(generateArena(JSON.parse(saved))).toEqual(actual);
        frequencies.set(
          actual.arena[axis],
          (frequencies.get(actual.arena[axis]) ?? 0) + 1,
        );
      }
      expect(frequencies).toEqual(
        new Map(
          buckets.map(([lower, upper, size]) => [size, upper - lower + 1]),
        ),
      );
    }
  });

  it("reaches every size pair and uses the same map for every supported player count", () => {
    const sizes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const seed = `tank-map-v1.2-${i}`;
      const { arena } = generateArena(createRealtimeRng(seed));
      expect(arena.cells.length).toBeGreaterThanOrEqual(
        Math.ceil(arena.cols * arena.rows * 0.85),
      );
      sizes.add(`${arena.cols}x${arena.rows}`);
      if (i < 15) {
        for (let count = 2; count <= 8; count++)
          expect(create(count, seed).state.arena).toEqual(arena);
      }
    }
    expect(sizes).toEqual(
      new Set(
        [6, 7, 8, 9, 10].flatMap((cols) =>
          [5, 6, 7].map((rows) => `${cols}x${rows}`),
        ),
      ),
    );
  });

  it.each([
    [tankMazeDefinitionV1_0_0, [8, 9, 10, 11, 12]],
    [tankMazeDefinitionV1_1_0, [6, 7, 8, 9, 10]],
  ] as const)(
    "retains historical map ranges for $0.manifest.gameVersion",
    (definition, widths) => {
      const columns = new Set<number>();
      const rows = new Set<number>();
      for (let i = 0; i < 100; i++) {
        const initial = create(8, `tank-historical-map-${i}`, definition);
        columns.add(initial.state.arena.cols);
        rows.add(initial.state.arena.rows);
      }
      expect(columns).toEqual(new Set(widths));
      expect(rows).toEqual(new Set([6, 7, 8, 9]));
    },
  );
});

describe.each([2, 3, 8])("tank maze minimum map with %i players", (count) => {
  it("spawns separated tanks inside the main region and clear of every wall", () => {
    const current = create(count);
    const { arena, tanks } = current.state;
    expect([arena.cols, arena.rows]).toEqual([6, 5]);
    expect(arena.cells.length).toBeGreaterThanOrEqual(26);
    expect(new Set(tanks.map((value) => `${value.x},${value.y}`)).size).toBe(
      count,
    );
    for (const value of tanks) {
      expect([value.x % 100000, value.y % 100000]).toEqual([50000, 50000]);
      expect(arena.cells).toContain(
        Math.floor(value.y / 100000) * arena.cols +
          Math.floor(value.x / 100000),
      );
      for (const wall of arena.walls) {
        const x = Math.max(wall.x, Math.min(value.x, wall.x + wall.w));
        const y = Math.max(wall.y, Math.min(value.y, wall.y + wall.h));
        expect((x - value.x) ** 2 + (y - value.y) ** 2).toBeGreaterThanOrEqual(
          19000 ** 2,
        );
      }
      for (const other of tanks) {
        if (value !== other)
          expect(
            (value.x - other.x) ** 2 + (value.y - other.y) ** 2,
          ).toBeGreaterThanOrEqual(38000 ** 2);
      }
    }
    expect(create(count)).toEqual(current);
  });

  it("starts after preparation and clears held input, weapons and projectiles at the next bout", () => {
    let current = create(count);
    for (let i = 0; i < 180; i++) current = step(current);
    expect(current.state.phase).toBe("ACTIVE");
    current = step(current, { type: "FIRE" });
    expect(current.state.bullets).toHaveLength(1);
    current.state.tanks.forEach((value) => {
      value.move = -1;
      value.turn = 1;
      value.lease = 30;
      value.weapon = "machine";
      value.ammo = 10;
      value.shield = 600;
    });
    current.state.pickups = [
      { id: 99, x: 350000, y: 350000, kind: "laser", life: 1200 },
    ];
    current.state.elapsed = 7199;
    const saved = JSON.stringify(current);
    const next = step(current);
    expect(JSON.stringify(current)).toBe(saved);
    expect(step(JSON.parse(saved))).toEqual(next);
    expect(next.state).toMatchObject({
      bout: 2,
      phase: "PREPARE",
      phaseTicks: 180,
      elapsed: 0,
      bullets: [],
      pickups: [],
      outcome: null,
    });
    expect(next.state.arena.rows).toBeGreaterThanOrEqual(5);
    expect(next.state.arena.rows).toBeLessThanOrEqual(7);
    for (const value of next.state.tanks)
      expect(value).toMatchObject({
        alive: true,
        move: 0,
        turn: 0,
        lease: 0,
        weapon: "normal",
        ammo: 0,
        shield: 0,
      });
    const positions = next.state.tanks.map(({ x, y }) => ({ x, y }));
    current = next;
    for (let i = 0; i < 181; i++) current = step(current);
    expect(current.state.phase).toBe("ACTIVE");
    expect(current.state.tanks.map(({ x, y }) => ({ x, y }))).toEqual(
      positions,
    );
  });
});
