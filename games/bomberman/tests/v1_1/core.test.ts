import { describe, expect, it } from "vitest";
import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";
import { configSchema, inputSchema } from "../../src/v1_1/contracts.js";
import {
  CELL_SIZE,
  classicMap,
  classicMode,
  spawnCells,
  supportedPlayerCounts,
  type MapDefinition,
} from "../../src/v1_1/definitions.js";
import { bombermanDefinition as game } from "../../src/v1_1/core/index.js";
import { resolveExplosions } from "../../src/v1_1/core/explosions.js";
import { generateArena } from "../../src/v1_1/core/map.js";
import { cellCenter, overlapsCell } from "../../src/v1_1/core/movement.js";
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
    expect(player(moved.state).x).toBe(x + 30 * 80);
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
  it("spends the normal movement budget on half-cell corner assistance", () => {
    const frame = openArena();
    player(frame.state).y += 180;
    let result = advance(frame, 3, [
      intent(0, { type: "MOVE", direction: "right" }),
    ]);
    expect(player(result.state)).toMatchObject({ x: 1860, y: 1800 });
    result = advance(result);
    expect(player(result.state)).toMatchObject({ x: 1940, y: 1800 });
  });
  it.each([-580, 580])(
    "assists just after the body midpoint clears a corner, offset %i",
    (offset) => {
      let frame = openArena();
      frame.state.arena.tiles[28] = "wall";
      frame.state.arena.tiles[30] = "wall";
      Object.assign(player(frame.state), { x: 4200 + offset, y: 1800 });
      frame = advance(frame, 8, [
        intent(0, { type: "MOVE", direction: "down" }),
      ]);
      expect(player(frame.state)).toMatchObject({ x: 4200, y: 1860 });
      expect(frame.state.arena.tiles[28]).toBe("wall");
      expect(frame.state.arena.tiles[30]).toBe("wall");
    },
  );
  it("does not pull toward a closed turn before halfway or snap through bombs", () => {
    const frame = openArena();
    frame.state.arena.tiles[28] = "wall";
    Object.assign(player(frame.state), { x: 3590, y: 1800 });
    expect(
      player(
        advance(frame, 8, [intent(0, { type: "MOVE", direction: "down" })])
          .state,
      ),
    ).toMatchObject({ x: 3590, y: 1800 });
    frame.state.arena.tiles[28] = "floor";
    frame.state.bombs = [bomb(frame.state, 2, 2, 1, 2, 100)];
    expect(
      player(
        advance(frame, 8, [intent(0, { type: "MOVE", direction: "down" })])
          .state,
      ),
    ).toMatchObject({ x: 3590, y: 1800 });
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
  it("takes only one life per damage batch and grants exactly two seconds of movable immunity", () => {
    let frame = openArena(3);
    player(frame.state).capacity = 3;
    player(frame.state).range = 5;
    player(frame.state).speed = 100;
    frame.state.bombs = [bomb(frame.state, 1, 1), bomb(frame.state, 2, 1, 2)];
    frame = advance(frame);
    const protectedUntil = frame.state.tick + 120;
    expect(player(frame.state)).toMatchObject({
      lives: 2,
      alive: true,
      x: 1800,
      y: 1800,
      capacity: 3,
      range: 5,
      speed: 100,
      invulnerableUntil: protectedUntil,
    });
    expect(
      frame.state.events.filter((event) => event.kind === "hit"),
    ).toHaveLength(1);
    frame = advance(frame, 1, [
      intent(0, { type: "MOVE", direction: "right" }),
      intent(0, { type: "PLACE_BOMB" }),
    ]);
    expect(player(frame.state)).toMatchObject({
      lives: 2,
      x: 1900,
      walking: true,
      invulnerableUntil: protectedUntil,
    });
    expect(frame.state.events.some((event) => event.kind === "place")).toBe(
      true,
    );
    frame = advance(frame, 118, [
      intent(0, { type: "MOVE", direction: "none" }),
    ]);
    expect(
      game.projectView({
        state: frame.state,
        viewer: { kind: "player", slotId: "p0" },
      }).players[0]?.invulnerableTicks,
    ).toBe(1);
    frame.state.bombs = [bomb(frame.state, 1, 1, 100, 2, frame.state.elapsed)];
    frame = advance(frame);
    expect(player(frame.state)).toMatchObject({
      lives: 1,
      alive: true,
      invulnerableUntil: frame.state.tick + 120,
    });
  });
  it("projects straight rays, central crosses and independently expiring intersections", () => {
    let frame = openArena();
    frame.state.bombs = [bomb(frame.state, 5, 5, 1, 3)];
    frame = advance(frame);
    const project = () =>
      game.projectView({
        state: frame.state,
        viewer: { kind: "player", slotId: "p0" },
      });
    expect(project().flames.find((flame) => flame.cell === 70)?.shape).toBe(
      "center",
    );
    expect(project().flames.find((flame) => flame.cell === 71)?.shape).toBe(
      "horizontal",
    );
    expect(project().flames.find((flame) => flame.cell === 57)?.shape).toBe(
      "vertical",
    );
    frame = advance(frame, 15);
    frame.state.bombs = [bomb(frame.state, 7, 3, 100, 3)];
    frame = advance(frame);
    expect(project().flames.find((flame) => flame.cell === 72)?.shape).toBe(
      "intersection",
    );
    frame = advance(frame, 14);
    expect(project().flames.find((flame) => flame.cell === 72)?.shape).toBe(
      "vertical",
    );
    expect(project().flames.some((flame) => flame.cell === 70)).toBe(false);
    frame = advance(frame, 16);
    expect(project().flames).toEqual([]);
  });
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
    frame.state.players.forEach((entry) => {
      entry.lives = 1;
    });
    frame.state.bombs = [bomb(frame.state, 4, 3)];
    const result = advance(frame);
    expect(
      result.state.players.every((entry) => !entry.alive && entry.lives === 0),
    ).toBe(true);
    expect(result.state.outcome).toMatchObject({
      type: "DRAW",
      winnerSlotId: null,
      reason: "ALL_ELIMINATED",
    });
    expect(result.state.phase).toBe("COMPLETE");
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
        kind === "capacity" ? 1 : kind === "range" ? 2 : 80,
      );
    },
  );
  it("takes one life on entry to a still-active flame even without a new explosion", () => {
    const frame = openArena(3);
    player(frame.state).x = 2 * 1200 - 360;
    frame.state.flames = [
      {
        cell: 15,
        expiresAt: 20,
        centerUntil: 20,
        horizontalUntil: 0,
        verticalUntil: 0,
      },
    ];
    expect(
      player(
        advance(frame, 1, [intent(0, { type: "MOVE", direction: "right" })])
          .state,
      ),
    ).toMatchObject({ alive: true, lives: 2, invulnerableUntil: 301 });
  });
});

describe("match lifecycle and privacy", () => {
  it("ends the single match in a draw at 180 seconds without comparing remaining lives", () => {
    let frame = openArena(4);
    player(frame.state).capacity = 5;
    player(frame.state).lives = 1;
    player(frame.state, 2).resigned = true;
    player(frame.state, 2).alive = false;
    player(frame.state, 2).lives = 0;
    frame.state.elapsed = 10799;
    frame = advance(frame);
    expect(frame.state.outcome).toMatchObject({
      type: "DRAW",
      winnerSlotId: null,
      reason: "TIMEOUT",
    });
    expect(frame.state.phase).toBe("COMPLETE");
    expect(advance(frame, 180)).toEqual(frame);
    const nextMatch = initial(4);
    expect(
      nextMatch.state.players.every(
        (entry) =>
          entry.alive &&
          entry.lives === 3 &&
          entry.capacity === 1 &&
          entry.speed === 80 &&
          entry.invulnerableUntil === 0,
      ),
    ).toBe(true);
  });
  it.each([2, 3, 4])(
    "awards the last survivor a single-match win after three hits with %i participants",
    (count) => {
      let frame = advance(initial(count), 180);
      for (let hit = 1; hit <= 3; hit += 1) {
        frame = advance(
          frame,
          151,
          Array.from({ length: count - 1 }, (_, index) =>
            intent(index, { type: "PLACE_BOMB" }),
          ),
        );
        expect(player(frame.state).lives).toBe(3 - hit);
        expect(player(frame.state, count - 1).lives).toBe(3);
        if (hit < 3) {
          expect(frame.state.outcome).toBeNull();
          frame = advance(frame, 30);
        }
      }
      expect(game.getOutcome(frame.state)).toMatchObject({
        type: "WIN",
        reason: "SURVIVOR",
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
  it("never awards a resigned player's lives or revives an eliminated competitor", () => {
    let frame = openArena(4);
    Object.assign(player(frame.state, 0), { lives: 0, alive: false });
    frame = advance(frame, 1, [
      intent(1, { type: "RESIGN" }),
      intent(2, { type: "RESIGN" }),
    ]);
    expect(frame.state.outcome).toMatchObject({
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: "p3",
    });
    expect(player(frame.state, 1)).toMatchObject({ lives: 0, resigned: true });
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
