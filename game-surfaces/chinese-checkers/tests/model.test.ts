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
  legalTargetsForSelection,
  outcomeLabel,
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
    expect(
      outcomeLabel({
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
      }),
    ).toBe("第一名：北营地");
  });
});
