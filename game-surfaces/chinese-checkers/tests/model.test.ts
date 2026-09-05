import { describe, expect, it } from "vitest";

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
  CHINESE_CHECKERS_CAMP_CELLS,
  CHINESE_CHECKERS_COORDINATES,
  campForCell,
  createCampIntent,
  createMovePieceIntent,
  createPlayerCountIntent,
  createResignIntent,
  createStarterIntent,
  layoutForCell,
  legalTargetsForSelection,
  outcomeLabel,
  resultSummary,
  setupStatusLabel,
} from "../src/model";

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

  it("keeps the independent 73-cell star geometry exact", () => {
    expect(CHINESE_CHECKERS_COORDINATES).toHaveLength(
      CHINESE_CHECKERS_CELL_COUNT,
    );
    expect(
      new Set(CHINESE_CHECKERS_COORDINATES.map(({ q, r }) => `${q},${r}`)).size,
    ).toBe(CHINESE_CHECKERS_CELL_COUNT);
    for (const camp of CHINESE_CHECKERS_CAMPS) {
      expect(CHINESE_CHECKERS_CAMP_CELLS[camp]).toHaveLength(6);
      expect(
        CHINESE_CHECKERS_CAMP_CELLS[camp].every(
          (cell) => campForCell(cell) === camp,
        ),
      ).toBe(true);
      const rows = CHINESE_CHECKERS_CAMP_CELLS[camp].reduce<
        Record<number, number>
      >((counts, cell) => {
        const coordinate = CHINESE_CHECKERS_COORDINATES[cell];
        if (coordinate === undefined)
          throw new Error("Missing camp coordinate.");
        const distance = Math.max(
          Math.abs(coordinate.q),
          Math.abs(coordinate.r),
          Math.abs(-coordinate.q - coordinate.r),
        );
        counts[distance] = (counts[distance] ?? 0) + 1;
        return counts;
      }, {});
      expect(rows).toEqual({ 4: 3, 5: 2, 6: 1 });
    }

    const tipCoordinates = [
      { q: 0, r: -6, x: 50, y: 5 },
      { q: 6, r: -6, x: 95, y: 27.5 },
      { q: 6, r: 0, x: 95, y: 72.5 },
      { q: 0, r: 6, x: 50, y: 95 },
      { q: -6, r: 6, x: 5, y: 72.5 },
      { q: -6, r: 0, x: 5, y: 27.5 },
    ];
    for (const tip of tipCoordinates) {
      const cell = CHINESE_CHECKERS_COORDINATES.findIndex(
        ({ q, r }) => q === tip.q && r === tip.r,
      );
      expect(layoutForCell(cell)).toMatchObject({ x: tip.x, y: tip.y });
    }

    for (const [cell, coordinate] of CHINESE_CHECKERS_COORDINATES.entries()) {
      const opposite = CHINESE_CHECKERS_COORDINATES.findIndex(
        ({ q, r }) => q === -coordinate.q && r === -coordinate.r,
      );
      const position = layoutForCell(cell);
      const oppositePosition = layoutForCell(opposite);
      expect(position.x + oppositePosition.x).toBeCloseTo(100);
      expect(position.y + oppositePosition.y).toBeCloseTo(100);
    }
  });

  it("accepts only projected legal moves and creates actor-free play intents", () => {
    const board = Array<string | null>(CHINESE_CHECKERS_CELL_COUNT).fill(null);
    for (const cell of CHINESE_CHECKERS_CAMP_CELLS.N) board[cell] = "slot-1";
    for (const cell of CHINESE_CHECKERS_CAMP_CELLS.S) board[cell] = "slot-2";
    const from = 2;
    const to = 10;
    board[to] = null;
    const view = chineseCheckersPlayViewSchema.parse({
      players: [
        { slotId: "slot-1", camp: "N" },
        { slotId: "slot-2", camp: "S" },
      ],
      board,
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
        legalMoves: [{ from, to: CHINESE_CHECKERS_CAMP_CELLS.S[0] }],
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
    const removableCell = CHINESE_CHECKERS_CAMP_CELLS.N[1];
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
