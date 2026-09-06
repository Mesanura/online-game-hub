import { describe, expect, it } from "vitest";
import {
  createRng,
  definePlayerSlotId,
  isJsonValue,
} from "@online-game-hub/game-sdk";
import {
  CHINESE_CHECKERS_CAMP_CELLS,
  CHINESE_CHECKERS_CENTER_CELLS,
  CHINESE_CHECKERS_COORDINATES,
  CHINESE_CHECKERS_GEOMETRY,
  adjacentCells,
  cellIndex,
  jumpLanding,
} from "../src/geometry.js";
import {
  chineseCheckersDefinition,
  chineseCheckersDefinitionV1_0_0,
} from "../src/core/index.js";

const ASCII_BOARD = [
  "         o",
  "        o o",
  "       o o o",
  "o o o o o o o o o o",
  " o o o o o o o o o",
  "  o o o o o o o o",
  "   o o o o o o o",
  "  o o o o o o o o",
  " o o o o o o o o o",
  "o o o o o o o o o o",
  "       o o o",
  "        o o",
  "         o",
];
const camps = ["N", "NE", "SE", "S", "SW", "NW"] as const;
const at = (column: number, row: number) => {
  const cell = cellIndex({ q: column, r: row });
  if (cell === undefined) throw new Error("Missing fixture cell.");
  return cell;
};

function fixtureValue<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Missing geometry fixture value.");
  return value;
}

describe("Chinese Checkers 1.1.0 star geometry", () => {
  it("matches every space and hole of the requested ASCII board", () => {
    const rows = Array.from({ length: 13 }, () => Array<string>(19).fill(" "));
    for (const { q, r } of CHINESE_CHECKERS_COORDINATES) {
      const row = rows[r + 6];
      if (row === undefined) throw new Error("Invalid row.");
      row[2 * q + r + 9] = "o";
    }
    expect(rows.map((row) => row.join("").trimEnd())).toEqual(ASCII_BOARD);
    expect(CHINESE_CHECKERS_CENTER_CELLS).toHaveLength(37);
    expect(
      new Set(CHINESE_CHECKERS_COORDINATES.map(({ q, r }) => q + "," + r)).size,
    ).toBe(73);
  });

  it("has a regular hexagon and six congruent side-three triangular camps", () => {
    for (const cell of CHINESE_CHECKERS_CENTER_CELLS) {
      const { q, r } = fixtureValue(CHINESE_CHECKERS_COORDINATES[cell]);
      expect(
        Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)),
      ).toBeLessThanOrEqual(3);
    }
    const tips = [
      [3, -6],
      [6, -3],
      [3, 3],
      [-3, 6],
      [-6, 3],
      [-3, -3],
    ] as const;
    for (const [index, camp] of camps.entries()) {
      const cells = CHINESE_CHECKERS_CAMP_CELLS[camp];
      const tip = fixtureValue(tips[index]);
      expect(cells).toHaveLength(6);
      expect(cells).toContain(at(tip[0], tip[1]));
      expect(
        cells
          .map(
            (cell) =>
              adjacentCells(cell).filter((neighbor) => cells.includes(neighbor))
                .length,
          )
          .sort(),
      ).toEqual([2, 2, 2, 4, 4, 4]);
      expect(
        cells.flatMap((cell) =>
          adjacentCells(cell).filter((neighbor) =>
            CHINESE_CHECKERS_CENTER_CELLS.includes(neighbor),
          ),
        ),
      ).toHaveLength(6);
      for (const cell of cells) {
        const { q, r } = fixtureValue(CHINESE_CHECKERS_COORDINATES[cell]);
        expect(
          CHINESE_CHECKERS_CAMP_CELLS[fixtureValue(camps[(index + 1) % 6])],
        ).toContain(at(-r, q + r));
      }
    }
    expect(
      new Set([
        ...CHINESE_CHECKERS_CENTER_CELLS,
        ...Object.values(CHINESE_CHECKERS_CAMP_CELLS).flat(),
      ]).size,
    ).toBe(73);
  });

  it("has 180 reciprocal equal-length edges and six axial jump directions", () => {
    let edges = 0;
    for (const [cell, { q, r }] of CHINESE_CHECKERS_COORDINATES.entries()) {
      expect(cellIndex({ q: -r, r: q + r })).toBeDefined();
      for (const neighbor of adjacentCells(cell)) {
        expect(adjacentCells(neighbor)).toContain(cell);
        const target = fixtureValue(CHINESE_CHECKERS_COORDINATES[neighbor]);
        const dx = target.q - q + (target.r - r) / 2;
        const dy = (Math.sqrt(3) * (target.r - r)) / 2;
        expect(Math.hypot(dx, dy)).toBeCloseTo(1);
        edges += 1;
      }
      for (let direction = 0; direction < 6; direction += 1) {
        const jump = jumpLanding(cell, direction);
        if (jump === null) continue;
        const over = fixtureValue(CHINESE_CHECKERS_COORDINATES[jump.over]);
        const landing = fixtureValue(
          CHINESE_CHECKERS_COORDINATES[jump.landing],
        );
        expect(landing).toEqual({ q: 2 * over.q - q, r: 2 * over.r - r });
      }
    }
    expect(edges / 2).toBe(180);
    expect(adjacentCells(at(3, -6))).toHaveLength(2);
  });

  it("projects immutable geometry for all viewers and preserves historical IDs", () => {
    const players = ["p1", "p2"].map(definePlayerSlotId);
    const context = {
      config: null,
      players,
      playerAssignments: ["N", "S"],
      rng: createRng("geometry"),
    };
    const current = chineseCheckersDefinition.createInitialState(context);
    const legacy = chineseCheckersDefinitionV1_0_0.createInitialState(context);
    expect(current.state.board).not.toEqual(legacy.state.board);
    for (const viewer of [
      { kind: "spectator" } as const,
      { kind: "player", slotId: fixtureValue(players[0]) } as const,
    ]) {
      const view = chineseCheckersDefinition.projectView({
        state: current.state,
        viewer,
      });
      expect(view.geometry).toEqual(CHINESE_CHECKERS_GEOMETRY);
      expect(Object.isFrozen(view.geometry)).toBe(true);
      expect(view.geometry.every(Object.isFrozen)).toBe(true);
      expect(isJsonValue(view)).toBe(true);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
      expect(
        chineseCheckersDefinitionV1_0_0.projectView({
          state: legacy.state,
          viewer,
        }),
      ).not.toHaveProperty("geometry");
    }
  });
});
