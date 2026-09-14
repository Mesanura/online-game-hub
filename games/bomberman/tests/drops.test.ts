import { describe, expect, it } from "vitest";
import { createRealtimeRng } from "@online-game-hub/realtime-game-sdk";
import { bombermanDefinition as game } from "../src/core/index.js";
import { cellCenter, overlapsCell, playerCell } from "../src/core/movement.js";
import type { Player } from "../src/core/model.js";
import type { PickupKind } from "../src/definitions.js";
import {
  advance,
  bomb,
  freeze,
  initial,
  intent,
  openArena,
  player,
  type Frame,
} from "./helpers.js";

const upgrades: PickupKind[] = [
  "capacity",
  "range",
  "speed",
  "range",
  "capacity",
  "speed",
  "range",
  "range",
  "range",
  "range",
  "range",
  "capacity",
];
const attributes = (actor: Player) => ({
  capacity: actor.capacity,
  range: actor.range,
  speed: actor.speed,
});
const heldCount = (actor: Player) =>
  actor.capacity - 2 + actor.range - 1 + (actor.speed - 80) / 10;
function collect(frame: Frame, kinds: readonly PickupKind[], index = 0): Frame {
  for (const kind of kinds) {
    frame.state.pickups.push({
      cell: playerCell(player(frame.state, index), frame.state.arena.cols),
      kind,
    });
    frame = advance(frame);
  }
  return frame;
}
function armHit(frame: Frame, index = 0): void {
  const actor = player(frame.state, index);
  frame.state.bombs.push(
    bomb(
      frame.state,
      Math.floor(actor.x / 1200),
      Math.floor(actor.y / 1200),
      1000 + index,
      1,
      frame.state.elapsed,
    ),
  );
}

describe("damage drops", () => {
  it.each([2, 3, 4])(
    "starts %i players with two bombs and one-cell power",
    (count) => {
      expect(initial(count).state.players.map(attributes)).toEqual(
        Array.from({ length: count }, () => ({
          capacity: 2,
          range: 1,
          speed: 80,
        })),
      );
    },
  );
  it.each([0, 1, 2, 3, 7, 12])(
    "drops half of %i effective held upgrades, rounded down",
    (count) => {
      const frame = collect(openArena(3), upgrades.slice(0, count));
      const before = attributes(player(frame.state));
      armHit(frame);
      const result = advance(frame);
      const actor = player(result.state);
      const lost = result.state.pickups;
      expect(lost).toHaveLength(Math.floor(count / 2));
      expect(heldCount(actor)).toBe(count - lost.length);
      expect(actor).toMatchObject({ lives: 2, alive: true });
      expect(actor.capacity).toBe(
        before.capacity -
          lost.filter((item) => item.kind === "capacity").length,
      );
      expect(actor.range).toBe(
        before.range - lost.filter((item) => item.kind === "range").length,
      );
      expect(actor.speed).toBe(
        before.speed - 10 * lost.filter((item) => item.kind === "speed").length,
      );
      expect(new Set(lost.map((item) => item.cell)).size).toBe(lost.length);
      for (const item of lost) {
        expect(result.state.arena.tiles[item.cell]).toBe("floor");
        expect(
          result.state.flames.some((flame) => flame.cell === item.cell),
        ).toBe(false);
        expect(
          result.state.players.some(
            (entry) =>
              entry.alive &&
              overlapsCell(
                entry.x,
                entry.y,
                item.cell,
                result.state.arena.cols,
              ),
          ),
        ).toBe(false);
      }
      if (count < 2) expect(result.rng).toEqual(frame.rng);
      else expect(result.rng.cursor).toBeGreaterThan(frame.rng.cursor);
    },
  );
  it("does not bank ineffective pickups beyond the stat caps", () => {
    const frame = collect(openArena(3), [
      ...upgrades,
      "capacity",
      "range",
      "speed",
    ]);
    expect(attributes(player(frame.state))).toEqual({
      capacity: 5,
      range: 8,
      speed: 100,
    });
    armHit(frame);
    const result = advance(frame);
    expect(result.state.pickups).toHaveLength(6);
    expect(heldCount(player(result.state))).toBe(6);
  });
  it("avoids walls, bricks, bombs, fire, visible or pending loot, and occupied cells", () => {
    const frame = collect(openArena(3), upgrades.slice(0, 4));
    const floor = new Set([14, 15, 16, 18, 20, 22, 24, 28, 29, 126]);
    frame.state.arena.tiles = frame.state.arena.tiles.map((_, cell) =>
      floor.has(cell) ? "floor" : cell === 30 ? "brick" : "wall",
    );
    Object.assign(player(frame.state, 1), cellCenter(22, 13));
    frame.state.bombs = [bomb(frame.state, 3, 1, 100, 1, 100)];
    frame.state.flames = [18, 24].map((cell) => ({
      cell,
      expiresAt: 100,
      centerUntil: 100,
      horizontalUntil: 0,
      verticalUntil: 0,
    }));
    frame.state.pickups = [{ cell: 20, kind: "speed" }];
    frame.state.pendingLoot = [{ cell: 18, kind: "range" }];
    armHit(frame);
    const result = advance(frame);
    expect(
      result.state.pickups
        .filter((item) => item.cell !== 20)
        .map((item) => item.cell)
        .sort((a, b) => a - b),
    ).toEqual([28, 29]);
    expect(result.state.pendingLoot).toEqual([{ cell: 18, kind: "range" }]);
  });
  it.each([0, 1])(
    "only removes upgrades that fit when %i empty cells remain",
    (spaces) => {
      const frame = collect(openArena(3), upgrades.slice(0, 6));
      const floor = new Set([14, 126, 128, ...(spaces ? [35] : [])]);
      frame.state.arena.tiles = frame.state.arena.tiles.map((_, cell) =>
        floor.has(cell) ? "floor" : "wall",
      );
      armHit(frame);
      const result = advance(frame);
      expect(result.state.pickups).toHaveLength(spaces);
      expect(heldCount(player(result.state))).toBe(6 - spaces);
      if (spaces === 0) expect(result.rng).toEqual(frame.rng);
    },
  );
  it("drops once for overlapping damage, never during immunity, and halves what remains on later hits", () => {
    let frame = collect(openArena(3), upgrades.slice(0, 4));
    armHit(frame);
    frame.state.bombs.push(bomb(frame.state, 2, 1, 999, 1));
    frame = advance(frame);
    expect(heldCount(player(frame.state))).toBe(2);
    expect(frame.state.pickups).toHaveLength(2);
    const immuneRng = frame.rng;
    armHit(frame);
    frame = advance(frame);
    expect(player(frame.state).lives).toBe(2);
    expect(frame.state.pickups).toHaveLength(2);
    expect(frame.rng).toEqual(immuneRng);
    frame = advance(frame, 120);
    armHit(frame);
    frame = advance(frame);
    expect(player(frame.state).lives).toBe(1);
    expect(heldCount(player(frame.state))).toBe(1);
    expect(frame.state.pickups).toHaveLength(3);
  });
  it("also drops upgrades on the final life, but resignation does not scatter items", () => {
    const frame = collect(openArena(3), upgrades.slice(0, 4));
    player(frame.state).lives = 1;
    const resigned = advance(frame, 1, [intent(0, { type: "RESIGN" })]);
    expect(resigned.state.pickups).toEqual([]);
    expect(resigned.rng).toEqual(frame.rng);
    armHit(frame);
    const eliminated = advance(frame);
    expect(player(eliminated.state)).toMatchObject({ alive: false, lives: 0 });
    expect(eliminated.state.pickups).toHaveLength(2);
    expect(eliminated.state.phase).toBe("ACTIVE");
  });
  it("lets players reclaim dropped upgrades and later explosions destroy unclaimed drops", () => {
    let frame = collect(openArena(3), ["range", "speed"]);
    const before = attributes(player(frame.state));
    armHit(frame);
    frame = advance(frame);
    const drop = frame.state.pickups[0];
    if (!drop) throw new Error("Missing dropped pickup");
    const destroyed = structuredClone(frame);
    destroyed.state.bombs.push(
      bomb(
        destroyed.state,
        drop.cell % 13,
        Math.floor(drop.cell / 13),
        2000,
        1,
        destroyed.state.elapsed,
      ),
    );
    expect(advance(destroyed).state.pickups).not.toContainEqual(drop);
    Object.assign(player(frame.state), cellCenter(drop.cell, 13));
    frame = advance(frame);
    expect(frame.state.pickups).toEqual([]);
    expect(attributes(player(frame.state))).toEqual(before);
  });
  it("retains already placed bombs above the reduced capacity and blocks new placement until space frees", () => {
    let frame = collect(openArena(3), ["capacity", "capacity"]);
    frame.state.bombs = (
      [
        [1, 5],
        [5, 5],
        [9, 5],
        [9, 8],
      ] as const
    ).map(([x, y], index) => bomb(frame.state, x, y, index + 1, 3, 1000));
    armHit(frame);
    frame = advance(frame);
    expect(player(frame.state).capacity).toBe(3);
    expect(frame.state.bombs).toHaveLength(4);
    expect(frame.state.bombs.every((entry) => entry.range === 3)).toBe(true);
    expect(
      game.projectView({
        state: frame.state,
        viewer: { kind: "player", slotId: "p0" },
      }).players[0],
    ).toMatchObject({ capacity: 3, activeBombs: 4 });
    Object.assign(player(frame.state), cellCenter(17, 13));
    frame = advance(frame, 1, [intent(0, { type: "PLACE_BOMB" })]);
    expect(frame.state.bombs).toHaveLength(4);
    for (const entry of frame.state.bombs.slice(0, 2))
      entry.explodeAt = frame.state.elapsed;
    frame = advance(frame);
    frame = advance(frame, 1, [intent(0, { type: "PLACE_BOMB" })]);
    expect(frame.state.bombs).toHaveLength(3);
  });
  it("is immutable, serializable, and seed-deterministic for simultaneous victims without duplicate drop cells", () => {
    let frame = collect(openArena(4), upgrades.slice(0, 6));
    frame = collect(frame, upgrades.slice(0, 6), 1);
    armHit(frame, 0);
    armHit(frame, 1);
    const before = JSON.stringify(frame);
    const result = advance(freeze(frame));
    expect(JSON.stringify(frame)).toBe(before);
    expect(advance(JSON.parse(before) as Frame)).toEqual(result);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result.state.pickups).toHaveLength(6);
    expect(new Set(result.state.pickups.map((entry) => entry.cell)).size).toBe(
      6,
    );
    expect(result.state.players.slice(0, 2).map(heldCount)).toEqual([3, 3]);
    const other = JSON.parse(before) as Frame;
    other.rng = createRealtimeRng("different-drop-seed");
    expect(advance(other).state.pickups).not.toEqual(result.state.pickups);
    const projection = game.projectView({
      state: result.state,
      viewer: { kind: "player", slotId: "p0" },
    });
    expect(projection.pickups).toEqual(result.state.pickups);
    expect(JSON.stringify(projection)).not.toMatch(
      /"(rng|seed|concealed|pendingLoot|lease|passThrough)"/,
    );
  });
});
