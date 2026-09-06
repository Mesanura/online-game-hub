import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { surfaceHostMessageSchema } from "@online-game-hub/game-surface-bridge";

import {
  CHINESE_CHECKERS_CAMPS,
  CHINESE_CHECKERS_CELL_COUNT,
  chineseCheckersPlayIntentSchema,
  chineseCheckersPlayViewSchema,
  chineseCheckersSetupIntentSchema,
  chineseCheckersSetupViewSchema,
} from "../src/contracts";
import {
  createCampIntent,
  createMovePieceIntent,
  createPlayerCountIntent,
  createResignIntent,
  createStarterIntent,
  legalTargetsForSelection,
  outcomeLabel,
  parsePlayView,
  resultSummary,
  setupStatusLabel,
} from "../src/model";
import { layoutBoard } from "../src/board";

function fixtureValue<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Missing board fixture value.");
  return value;
}

const projected = JSON.parse(
  readFileSync(
    new URL("./fixtures/initial-view-1.1.0.json", import.meta.url),
    "utf8",
  ),
) as unknown;
const legacy = JSON.parse(
  readFileSync(
    new URL("./fixtures/initial-view-1.0.0.json", import.meta.url),
    "utf8",
  ),
) as unknown;
const geometry = chineseCheckersPlayViewSchema.parse(projected).geometry;
const campCells = (camp: string) =>
  geometry.flatMap((cell, index) => (cell.camp === camp ? [index] : []));

describe("Chinese Checkers Surface model", () => {
  it("accepts strict game-owned setup projections and minimal intents", () => {
    const setup = chineseCheckersSetupViewSchema.parse({
      targetPlayerCount: 3,
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
      participants: [
        { slotId: "slot-1", isOwner: true, camp: "N" },
        { slotId: "slot-2", isOwner: false, camp: "S" },
      ],
      canEditRules: true,
      canSelectCamp: true,
      yourCamp: "N",
    });
    expect(setupStatusLabel(setup)).toContain("等待 3 位玩家");
    expect(
      chineseCheckersSetupIntentSchema.parse(createPlayerCountIntent(3)),
    ).toEqual({ type: "SELECT_PLAYER_COUNT", playerCount: 3 });
    expect(
      chineseCheckersSetupIntentSchema.parse(createCampIntent("NE")),
    ).toEqual({ type: "SELECT_CAMP", camp: "NE" });
    expect(
      chineseCheckersSetupIntentSchema.parse(createStarterIntent("OWNER")),
    ).toEqual({ type: "SELECT_STARTER", starter: "OWNER" });
  });

  it("lays out the projected 13-row star with equal spacing and triangular camps", () => {
    const layout = layoutBoard(geometry, "1.1.0");
    expect(layout.rows.map((row) => row.length)).toEqual([
      1, 2, 3, 10, 9, 8, 7, 8, 9, 10, 3, 2, 1,
    ]);
    expect(layout.cells).toHaveLength(CHINESE_CHECKERS_CELL_COUNT);
    for (const camp of CHINESE_CHECKERS_CAMPS) {
      const region = fixtureValue(
        layout.regions.find((region) => region.camp === camp),
      );
      expect(region.points).toHaveLength(3);
      for (const [index, corner] of region.points.entries()) {
        const nextCorner = fixtureValue(
          region.points[(index + 1) % region.points.length],
        );
        expect(
          Math.hypot(corner.x - nextCorner.x, corner.y - nextCorner.y),
        ).toBeCloseTo(120);
      }
    }
    expect(
      layout.regions.find((region) => region.camp === null)?.points,
    ).toHaveLength(6);
    for (const cell of layout.cells) {
      expect(cell.x).toBeGreaterThan(layout.cellDiameter / 2);
      expect(cell.y).toBeGreaterThan(layout.cellDiameter / 2);
      expect(cell.x).toBeLessThan(layout.width - layout.cellDiameter / 2);
      expect(cell.y).toBeLessThan(layout.height - layout.cellDiameter / 2);
      const opposite = fixtureValue(
        layout.cells.find(
          (candidate) => candidate.q === -cell.q && candidate.r === -cell.r,
        ),
      );
      expect(cell.x + opposite.x).toBeCloseTo(layout.width);
      expect(cell.y + opposite.y).toBeCloseTo(layout.height);
    }
  });

  it("draws exactly the 180 unique equal-length adjacent links", () => {
    const layout = layoutBoard(geometry, "1.1.0");
    expect(layout.connections).toHaveLength(180);
    const seen = new Set<string>();
    for (const { from, to } of layout.connections) {
      expect(from).toBeLessThan(to);
      const start = fixtureValue(layout.cells[from]);
      const end = fixtureValue(layout.cells[to]);
      expect(Math.hypot(start.x - end.x, start.y - end.y)).toBeCloseTo(60);
      seen.add(from + ":" + to);
    }
    expect(seen.size).toBe(180);
  });

  it("dispatches exact versions and never falls back to historical geometry", () => {
    const view = parsePlayView(projected, "1.1.0");
    expect(view.geometry).toEqual(geometry);
    const historical = parsePlayView(legacy, "1.0.0");
    expect(layoutBoard(historical.geometry, "1.0.0").connections).toHaveLength(
      162,
    );
    expect(historical.geometry).not.toEqual(geometry);
    expect(() => parsePlayView(legacy, "1.1.0")).toThrow();
    expect(() => parsePlayView(projected, "1.0.0")).toThrow();
    expect(() => parsePlayView(projected, "2.0.0")).toThrow();
    expect(() => layoutBoard(geometry, "2.0.0")).toThrow();
    expect(() =>
      parsePlayView(
        { ...view, geometry: [...geometry.slice(1), geometry[1]] },
        "1.1.0",
      ),
    ).toThrow();
    expect(() =>
      parsePlayView(
        {
          ...view,
          geometry: geometry.map((cell) => ({ ...cell, camp: null })),
        },
        "1.1.0",
      ),
    ).toThrow();
  });

  it("accepts only projected legal moves and creates actor-free play intents", () => {
    const board = Array<string | null>(CHINESE_CHECKERS_CELL_COUNT).fill(null);
    for (const cell of campCells("N")) board[cell] = "slot-1";
    for (const cell of campCells("S")) board[cell] = "slot-2";
    const from = 2;
    const to = 10;
    board[to] = null;
    const view = chineseCheckersPlayViewSchema.parse({
      players: [
        { slotId: "slot-1", camp: "N" },
        { slotId: "slot-2", camp: "S" },
      ],
      board,
      geometry,
      nextTurnSlotId: "slot-1",
      legalMoves: [{ from, to }],
      rankings: [],
      outcome: null,
      yourCamp: "N",
    });
    expect(legalTargetsForSelection(view.legalMoves, from)).toEqual([to]);
    expect(
      chineseCheckersPlayIntentSchema.parse(createMovePieceIntent(from, to)),
    ).toEqual({ type: "MOVE_PIECE", from, to });
    expect(chineseCheckersPlayIntentSchema.parse(createResignIntent())).toEqual(
      { type: "RESIGN" },
    );
    expect(
      surfaceHostMessageSchema.safeParse({
        type: "surface.intent",
        clientIntentId: "chinese-checkers-1",
        intent: { ...createMovePieceIntent(from, to), actor: "slot-1" },
      }).success,
    ).toBe(false);
    expect(
      chineseCheckersPlayViewSchema.safeParse({ ...view, rawState: {} })
        .success,
    ).toBe(false);
    expect(
      chineseCheckersPlayViewSchema.safeParse({
        ...view,
        legalMoves: [{ from, to: campCells("S")[0] }],
      }).success,
    ).toBe(false);
    expect(
      chineseCheckersPlayViewSchema.safeParse({
        ...view,
        nextTurnSlotId: null,
        legalMoves: [],
      }).success,
    ).toBe(false);
    expect(
      chineseCheckersPlayViewSchema.safeParse({
        ...view,
        legalMoves: [],
      }).success,
    ).toBe(false);
    const missingPieceBoard = [...view.board];
    const removableCell = campCells("N")[1];
    if (removableCell === undefined) throw new Error("Missing camp cell.");
    missingPieceBoard[removableCell] = null;
    expect(
      chineseCheckersPlayViewSchema.safeParse({
        ...view,
        board: missingPieceBoard,
      }).success,
    ).toBe(false);
    expect(
      chineseCheckersPlayViewSchema.safeParse({
        ...view,
        yourCamp: "NE",
      }).success,
    ).toBe(false);
    const terminal = chineseCheckersPlayViewSchema.parse({
      ...view,
      nextTurnSlotId: null,
      legalMoves: [],
      rankings: [
        { slotId: "slot-1", rank: 1, reason: "LAST_REMAINING" },
        { slotId: "slot-2", rank: 2, reason: "RESIGNATION" },
      ],
      outcome: {
        type: "RANKING",
        rankings: [
          { slotId: "slot-1", rank: 1, reason: "LAST_REMAINING" },
          { slotId: "slot-2", rank: 2, reason: "RESIGNATION" },
        ],
      },
    });
    expect(outcomeLabel(terminal)).toBe("第一名：北营地");
    expect(resultSummary(terminal)).toEqual({
      tone: "win",
      headline: "你获得第 1 名",
      details: [
        "第 1 名：北营地（最后一名未排名玩家）",
        "第 2 名：南营地（投降）",
      ],
    });
  });
});
