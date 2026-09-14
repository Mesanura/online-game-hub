import { describe, expect, it } from "vitest";
import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";
import { configSchema, inputSchema } from "../../src/v1/contracts.js";
import {
  CELL_SIZE,
  classicMap,
  classicMode,
  spawnCells,
  supportedPlayerCounts,
  type MapDefinition,
} from "../../src/v1/definitions.js";
import { bombermanDefinition as game } from "../../src/v1/core/index.js";
import { resolveExplosions } from "../../src/v1/core/explosions.js";
import { generateArena } from "../../src/v1/core/map.js";
import { cellCenter, overlapsCell } from "../../src/v1/core/movement.js";
import {
  advance,
  bomb,
  freeze,
  initial,
  intent,
  openArena,
  player,
} from "./helpers.js";

describe("arena and deterministic setup", () => {
  it.each([2, 3, 4])(
    "creates %i distinct safe participants with symmetric bricks and loot",
    (count) => {
      for (let seed = 0; seed < 20; seed += 1) {
        const frame = initial(count, "arena-" + seed);
        const { arena, players } = frame.state;
        expect(
          new Set(players.map((entry) => entry.x + "," + entry.y)).size,
        ).toBe(count);
        expect(
          players.every((entry) =>
            classicMap.safeCells.includes(
              Math.floor(entry.y / CELL_SIZE) * arena.cols +
                Math.floor(entry.x / CELL_SIZE),
            ),
          ),
        ).toBe(true);
        expect(
          classicMap.safeCells.every((cell) => arena.tiles[cell] === "floor"),
        ).toBe(true);
        for (let cell = 0; cell < arena.tiles.length; cell += 1) {
          const x = cell % arena.cols;
          const y = Math.floor(cell / arena.cols);
          for (const mirror of [
            y * arena.cols + arena.cols - 1 - x,
            (arena.rows - 1 - y) * arena.cols + x,
          ]) {
            expect(arena.tiles[cell]).toBe(arena.tiles[mirror]);
            expect(
              arena.concealed.find((loot) => loot.cell === cell)?.kind,
            ).toBe(arena.concealed.find((loot) => loot.cell === mirror)?.kind);
          }
        }
        expect(initial(count, "arena-" + seed)).toEqual(frame);
      }
    },
  );
  it("supports a larger six-seat arena in the game-owned definition helpers", () => {
    const map: MapDefinition = {
      id: "test-six",
      cols: 19,
      rows: 15,
      walls: [],
      safeCells: [20, 22, 24, 26, 28, 30],
      brickGroups: [[50, 60]],
      spawnCycle: [20, 22, 24, 26, 28, 30],
      spawnLayouts: { 6: [0, 1, 2, 3, 4, 5] },
      brickPercent: 100,
    };
    expect(supportedPlayerCounts(map, classicMode)).toEqual([6]);
    expect(spawnCells(map, 6, 1)).toEqual([22, 24, 26, 28, 30, 20]);
    const result = generateArena(map, classicMode, createRealtimeRng("six"));
    expect(result.arena.tiles).toHaveLength(19 * 15);
    expect(result.arena.tiles[50]).toBe("brick");
    expect(() => spawnCells(map, 4, 0)).toThrow();
  });
  it("rejects invalid configuration, duplicate participants and forged input fields", () => {
    for (const playerCount of [1, 5, 2.5, -1])
      expect(
        configSchema.safeParse({
          mapId: "classic-arena",
          modeId: "classic",
          playerCount,
        }).success,
      ).toBe(false);
    expect(
      configSchema.safeParse({
        mapId: "other",
        modeId: "classic",
        playerCount: 2,
      }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({ type: "MOVE", direction: "diagonal" }).success,
    ).toBe(false);
    for (const field of ["actor", "slotId", "x", "state", "tick"])
      expect(
        inputSchema.safeParse({ type: "PLACE_BOMB", [field]: "forged" })
          .success,
      ).toBe(false);
    expect(() =>
      game.createInitialState({
        config: { mapId: "classic-arena", modeId: "classic", playerCount: 2 },
        players: [
          defineRealtimePlayerSlotId("p0"),
          defineRealtimePlayerSlotId("p0"),
        ],
        rng: createRealtimeRng("invalid"),
      }),
    ).toThrow();
  });
});

describe("movement and input lifetime", () => {
  it("ignores pre-game controls, preserves event delivery and expires exactly after 30 movement ticks", () => {
    const before = initial();
    const ignored = advance(before, 1, [
      intent(0, { type: "PLACE_BOMB" }),
      intent(0, { type: "MOVE", direction: "right" }),
    ]);
    expect(ignored.state.bombs).toEqual([]);
    expect(ignored.rng).toEqual(before.rng);
    expect(player(ignored.state).lease).toBe(0);
    const frame = openArena();
    const x = player(frame.state).x;
    const moved = advance(frame, 30, [
      intent(0, { type: "MOVE", direction: "right" }),
    ]);
    expect(player(moved.state).x).toBe(x + 30 * 60);
    expect(player(advance(moved).state).x).toBe(player(moved.state).x);
    const stopped = advance(moved, 1, [
      intent(0, { type: "PLACE_BOMB" }),
      intent(0, { type: "MOVE", direction: "none" }),
    ]);
    expect(stopped.state.bombs).toHaveLength(1);
    expect(player(stopped.state).x).toBe(player(moved.state).x);
  });
  it.each(["left", "up", "right", "down"] as const)(
    "clamps the body against the %s outer wall",
    (direction) => {
      const frame = openArena();
      const actor = player(frame.state);
      Object.assign(
        actor,
        cellCenter(
          (direction === "right" ? 11 : 1) +
            (direction === "down" ? 9 : 1) * 13,
          13,
        ),
      );
      const result = advance(frame, 30, [
        intent(0, { type: "MOVE", direction }),
      ]);
      const end = player(result.state);
      expect(
        direction === "left"
          ? end.x
          : direction === "up"
            ? end.y
            : direction === "right"
              ? end.x
              : end.y,
      ).toBe(
        direction === "right"
          ? 12 * 1200 - 360
          : direction === "down"
            ? 10 * 1200 - 360
            : 1200 + 360,
      );
    },
  );
  it("spends the movement budget on axis-aligned corner assistance and rejects distant turns", () => {
    const frame = openArena();
    player(frame.state).y += 180;
    let result = advance(frame, 3, [
      intent(0, { type: "MOVE", direction: "right" }),
    ]);
    expect(player(result.state)).toMatchObject({ x: 1800, y: 1800 });
    result = advance(result);
    expect(player(result.state)).toMatchObject({ x: 1860, y: 1800 });
    const distant = openArena();
    player(distant.state).y += 300;
    expect(
      player(
        advance(distant, 5, [intent(0, { type: "MOVE", direction: "right" })])
          .state,
      ),
    ).toMatchObject({ x: 1800, y: 2100 });
  });
  it("lets players overlap, exit their new bomb and then prevents reentry", () => {
    let frame = openArena(3);
    Object.assign(player(frame.state, 1), { x: 1800, y: 1800 });
    frame = advance(frame, 1, [intent(0, { type: "PLACE_BOMB" })]);
    expect(frame.state.bombs[0]?.passThrough).toEqual(["p0", "p1"]);
    frame = advance(frame, 30, [
      intent(0, { type: "MOVE", direction: "right" }),
      intent(1, { type: "MOVE", direction: "right" }),
    ]);
    expect(player(frame.state).x).toBe(player(frame.state, 1).x);
    expect(frame.state.bombs[0]?.passThrough).toEqual([]);
    frame = advance(frame, 30, [
      intent(0, { type: "MOVE", direction: "left" }),
    ]);
    expect(player(frame.state).x).toBe(2760);
    expect(
      overlapsCell(player(frame.state).x, player(frame.state).y, 14, 13),
    ).toBe(false);
  });
});

describe("bombs, explosions and loot", () => {
  it("never queues blocked placement and snapshots the range before a pickup", () => {
    let frame = openArena();
    frame.state.pickups.push({ cell: 14, kind: "range" });
    frame = advance(frame, 1, [
      intent(0, { type: "PLACE_BOMB" }),
      intent(0, { type: "PLACE_BOMB" }),
    ]);
    expect(frame.state.bombs).toHaveLength(1);
    expect(frame.state.bombs[0]?.range).toBe(2);
    expect(player(frame.state).range).toBe(3);
    Object.assign(player(frame.state), cellCenter(18, 13));
    frame = advance(frame, 1, [intent(0, { type: "PLACE_BOMB" })]);
    expect(frame.state.bombs).toHaveLength(1);
    frame = advance(frame, 160);
    expect(frame.state.phase).toBe("ACTIVE");
    expect(frame.state.bombs).toEqual([]);
  });
  it("chains bombs once and stops the initiating ray at the chained bomb", () => {
    const { state } = openArena();
    state.bombs = [bomb(state, 1, 5, 1, 5), bomb(state, 3, 5, 2, 1, 100)];
    expect(resolveExplosions(state, classicMode)).toEqual([66, 68]);
    expect(state.bombs).toEqual([]);
    expect(state.flames.some((flame) => flame.cell === 70)).toBe(false);
    expect(
      state.flames.every((flame) => state.arena.tiles[flame.cell] !== "wall"),
    ).toBe(true);
  });
  it("uses the pre-explosion brick snapshot regardless of bomb processing order", () => {
    const result = (reverse: boolean) => {
      const { state } = openArena();
      state.arena.tiles[43] = "brick";
      state.bombs = [
        bomb(state, 3, 3, reverse ? 2 : 1, 5),
        bomb(state, 4, 1, reverse ? 1 : 2, 5),
      ];
      resolveExplosions(state, classicMode);
      expect(state.arena.tiles[43]).toBe("floor");
      expect(state.flames.some((flame) => flame.cell === 44)).toBe(false);
      return state.flames;
    };
    expect(result(true)).toEqual(result(false));
  });
  it("applies simultaneous self/other damage before selecting a survivor", () => {
    const frame = openArena();
    Object.assign(player(frame.state), cellCenter(42, 13));
    Object.assign(player(frame.state, 1), cellCenter(44, 13));
    frame.state.bombs = [bomb(frame.state, 4, 3)];
    const result = advance(frame);
    expect(
      result.state.players.every((entry) => !entry.alive && entry.score === 0),
    ).toBe(true);
    expect(result.state.roundResult).toEqual({
      winnerSlotId: null,
      reason: "ALL_ELIMINATED",
    });
    expect(result.state.outcome).toBeNull();
  });
  it("keeps loot hidden through the complete flame lifetime and burns exposed loot later", () => {
    let frame = openArena();
    frame.state.arena.tiles[70] = "brick";
    frame.state.arena.concealed = [{ cell: 70, kind: "capacity" }];
    frame.state.bombs = [bomb(frame.state, 4, 5)];
    frame = advance(frame);
    expect(frame.state.pendingLoot).toEqual([{ cell: 70, kind: "capacity" }]);
    expect(frame.state.pickups).toEqual([]);
    expect(
      JSON.stringify(
        game.projectView({
          state: frame.state,
          viewer: { kind: "player", slotId: "p0" },
        }),
      ),
    ).not.toContain("pendingLoot");
    frame = advance(frame, 29);
    expect(frame.state.pickups).toEqual([]);
    frame = advance(frame);
    expect(frame.state.pickups).toEqual([{ cell: 70, kind: "capacity" }]);
    frame.state.bombs = [bomb(frame.state, 4, 5, 100, 2, frame.state.elapsed)];
    frame = advance(frame);
    expect(frame.state.pickups).toEqual([]);
  });
  it.each(["capacity", "range", "speed"] as const)(
    "caps %s pickups and uses stable order for equal-distance claims",
    (kind) => {
      let frame = openArena(3);
      Object.assign(player(frame.state, 1), { x: 1800, y: 1800 });
      for (let index = 0; index < 10; index += 1) {
        frame.state.pickups.push({ cell: 14, kind });
        frame = advance(frame);
      }
      expect(player(frame.state)[kind]).toBe(
        kind === "capacity" ? 5 : kind === "range" ? 8 : 100,
      );
      expect(player(frame.state, 1)[kind]).toBe(
        kind === "capacity" ? 1 : kind === "range" ? 2 : 60,
      );
    },
  );
  it("kills on entry to a still-active flame even without a new explosion", () => {
    const frame = openArena(3);
    player(frame.state).x = 2 * 1200 - 360;
    frame.state.flames = [{ cell: 15, expiresAt: 20 }];
    expect(
      player(
        advance(frame, 1, [intent(0, { type: "MOVE", direction: "right" })])
          .state,
      ).alive,
    ).toBe(false);
  });
});

describe("match lifecycle and privacy", () => {
  it("draws at 180 seconds, freezes the result, rotates spawns and resets per-bout state", () => {
    let frame = openArena(4);
    const rotation = frame.state.spawnRotation;
    player(frame.state).capacity = 5;
    player(frame.state, 2).resigned = true;
    player(frame.state, 2).alive = false;
    frame.state.elapsed = 10799;
    frame = advance(frame);
    expect(frame.state.roundResult).toEqual({
      winnerSlotId: null,
      reason: "TIMEOUT",
    });
    const tiles = frame.state.arena.tiles;
    frame = advance(frame, 119);
    expect(frame.state.arena.tiles).toEqual(tiles);
    expect(frame.state.phase).toBe("RESULT");
    frame = advance(frame);
    expect(frame.state).toMatchObject({
      bout: 2,
      phase: "PREPARE",
      phaseTicks: 180,
      elapsed: 0,
      spawnRotation: (rotation + 1) % 4,
      bombs: [],
      flames: [],
      pickups: [],
      pendingLoot: [],
    });
    expect(player(frame.state)).toMatchObject({
      alive: true,
      capacity: 1,
      range: 2,
      speed: 60,
      lease: 0,
    });
    expect(player(frame.state, 2)).toMatchObject({
      alive: false,
      resigned: true,
    });
  });
  it.each([2, 3, 4])(
    "awards a genuine three-bout win with %i participants",
    (count) => {
      let frame = initial(count);
      for (let bout = 1; bout <= 3; bout += 1) {
        frame = advance(frame, 180);
        frame = advance(
          frame,
          151,
          Array.from({ length: count - 1 }, (_, index) =>
            intent(index, { type: "PLACE_BOMB" }),
          ),
        );
        expect(player(frame.state, count - 1).score).toBe(bout);
        if (bout < 3) frame = advance(frame, 120);
      }
      expect(game.getOutcome(frame.state)).toMatchObject({
        type: "WIN",
        reason: "SCORE",
        winnerSlotId: "p" + (count - 1),
      });
      expect(
        advance(frame, 2, [intent(count - 1, { type: "PLACE_BOMB" })]),
      ).toEqual(frame);
    },
  );
  it("handles permanent resignation during preparation and simultaneous all-player resignation", () => {
    let frame = initial(3);
    frame = advance(frame, 1, [intent(0, { type: "RESIGN" })]);
    expect(frame.state.outcome).toBeNull();
    frame = advance(frame, 1, [intent(1, { type: "RESIGN" })]);
    expect(frame.state.outcome).toMatchObject({
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: "p2",
    });
    const draw = advance(initial(), 1, [
      intent(0, { type: "RESIGN" }),
      intent(1, { type: "RESIGN" }),
    ]);
    expect(draw.state.outcome).toMatchObject({
      type: "DRAW",
      winnerSlotId: null,
    });
  });
  it("projects only public fields and produces independent JSON-safe views", () => {
    const frame = advance(openArena(), 1, [
      intent(0, { type: "PLACE_BOMB" }),
      intent(0, { type: "MOVE", direction: "right" }),
    ]);
    const before = JSON.stringify(frame);
    const view = game.projectView({
      state: freeze(frame.state),
      viewer: { kind: "player", slotId: "p0" },
    });
    const serialized = JSON.stringify(view);
    for (const hidden of [
      "concealed",
      "pendingLoot",
      "lease",
      "passThrough",
      "direction",
      "seed",
      "rng",
    ])
      expect(serialized).not.toContain('"' + hidden + '"');
    expect(JSON.parse(serialized)).toEqual(view);
    view.arena.tiles[14] = "wall";
    expect(JSON.stringify(frame)).toBe(before);
  });
  it("is immutable and identical across JSON reconstruction at every tick", () => {
    let left = initial(4, "determinism");
    let right = JSON.parse(JSON.stringify(left)) as typeof left;
    for (let tick = 0; tick < 700; tick += 1) {
      const inputs =
        tick % 61 === 0
          ? [
              intent(tick % 4, { type: "PLACE_BOMB" }),
              intent(tick % 4, { type: "MOVE", direction: "left" }),
            ]
          : [];
      const before = JSON.stringify(left);
      const next = game.step({
        state: freeze(left.state),
        rng: freeze(left.rng),
        inputs: freeze(inputs),
        tick,
      });
      expect(JSON.stringify(left)).toBe(before);
      right = game.step({ ...right, inputs, tick });
      expect(right).toEqual(next);
      expect(JSON.parse(JSON.stringify(next))).toEqual(next);
      left = next;
      right = JSON.parse(JSON.stringify(right)) as typeof right;
    }
  });
});
