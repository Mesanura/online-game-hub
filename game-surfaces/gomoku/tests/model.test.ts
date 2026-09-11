import { describe, expect, it } from "vitest";

import { surfaceHostMessageSchema } from "@online-game-hub/game-surface-bridge";

import {
  gomokuPlayIntentSchema,
  gomokuHistoricalPlayIntentSchema,
  gomokuPlayViewSchema,
  gomokuSetupIntentSchema,
  gomokuSetupViewSchema,
} from "../src/contracts";
import {
  createBoardSizeIntent,
  createPlaceStoneIntent,
  createResignIntent,
  createSetupIntent,
  outcomeLabel,
  resultSummary,
  setupStatusLabel,
} from "../src/model";

const emptyBoard: (string | null)[] = Array.from({ length: 225 }, () => null);

describe("Gomoku Surface model", () => {
  it.each([15, 19] as const)(
    "submits only the selected %i board size",
    (boardSize) => {
      expect(
        gomokuSetupIntentSchema.parse(createBoardSizeIntent(boardSize)),
      ).toEqual({ type: "SET_BOARD_SIZE", boardSize });
      expect(
        gomokuSetupIntentSchema.safeParse({
          ...createBoardSizeIntent(boardSize),
          actor: "slot-a",
        }).success,
      ).toBe(false);
      expect(
        gomokuSetupIntentSchema.safeParse({
          type: "SET_BOARD_SIZE",
          boardSize: 17,
        }).success,
      ).toBe(false);
    },
  );
  it.each([15, 19] as const)(
    "validates the complete square projected board of size %i",
    (boardSize) => {
      const view = {
        boardSize,
        winLength: 5,
        players: [
          { slotId: "slot-a", stone: "BLACK" },
          { slotId: "slot-b", stone: "WHITE" },
        ],
        board: Array<string | null>(boardSize * boardSize).fill(null),
        nextTurnSlotId: "slot-a",
        outcome: null,
        yourStone: "BLACK",
      };
      expect(gomokuPlayViewSchema.parse(view)).toEqual(view);
      for (const invalid of [
        { ...view, nextPlayerIndex: 0 },
        { ...view, board: [null] },
        { ...view, winLength: 6 },
        { ...view, board: [...view.board.slice(0, -1), "unknown-slot"] },
        { ...view, nextTurnSlotId: "unknown-slot" },
        {
          ...view,
          players: [
            { slotId: "slot-a", stone: "BLACK" },
            { slotId: "slot-a", stone: "WHITE" },
          ],
        },
        {
          ...view,
          nextTurnSlotId: null,
          outcome: {
            type: "WIN",
            winnerSlotId: "slot-a",
            winningCells: [0, 1, 2, 3, boardSize * boardSize],
          },
        },
      ])
        expect(gomokuPlayViewSchema.safeParse(invalid).success).toBe(false);
      expect(
        outcomeLabel(
          gomokuPlayViewSchema.parse({
            ...view,
            nextTurnSlotId: null,
            outcome: { type: "DRAW" },
          }),
        ),
      ).toBe("本局平局");
    },
  );

  it("accepts strict setup projection and minimal starter intent", () => {
    const setup = gomokuSetupViewSchema.parse({
      config: { boardSize: 15, winLength: 5 },
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
      participantSlotIds: ["slot-a", "slot-b"],
      canEdit: true,
    });
    expect(setupStatusLabel(setup)).toBe("请选择本局先手");
    expect(gomokuSetupIntentSchema.parse(createSetupIntent("OWNER"))).toEqual({
      type: "SELECT_STARTER",
      starter: "OWNER",
    });
  });

  it("creates only a cell intent and rejects platform-owned fields", () => {
    expect(gomokuPlayIntentSchema.parse(createPlaceStoneIntent(105))).toEqual({
      type: "PLACE_STONE",
      cell: 105,
    });
    expect(gomokuPlayIntentSchema.parse(createResignIntent())).toEqual({
      type: "RESIGN",
    });
    expect(
      gomokuHistoricalPlayIntentSchema.safeParse(createResignIntent()).success,
    ).toBe(false);
    expect(
      gomokuPlayIntentSchema.safeParse({
        ...createPlaceStoneIntent(105),
        expectedRevision: 3,
      }).success,
    ).toBe(false);
    expect(
      surfaceHostMessageSchema.safeParse({
        type: "surface.intent",
        clientIntentId: "gomoku-1",
        intent: { ...createPlaceStoneIntent(105), actor: "slot-a" },
      }).success,
    ).toBe(false);
  });

  it("parses the projected board and both supported outcome generations", () => {
    const view = gomokuPlayViewSchema.parse({
      boardSize: 15,
      winLength: 5,
      players: [
        { slotId: "slot-a", stone: "BLACK" },
        { slotId: "slot-b", stone: "WHITE" },
      ],
      board: emptyBoard,
      nextTurnSlotId: null,
      outcome: {
        type: "WIN",
        winnerSlotId: "slot-a",
        winningCells: [105, 106, 107, 108, 109],
      },
      yourStone: "BLACK",
    });
    expect(outcomeLabel(view)).toBe("你赢了");
    expect(resultSummary(view)).toEqual({ tone: "win", headline: "你获胜" });
    expect(
      gomokuPlayViewSchema.safeParse({ ...view, rawState: {} }).success,
    ).toBe(false);
    for (const outcome of [
      {
        type: "WIN",
        winnerSlotId: "unknown-slot",
        winningCells: [105, 106, 107, 108, 109],
      },
      {
        type: "WIN",
        reason: "RESIGNATION",
        winnerSlotId: "slot-a",
        resignedSlotId: "unknown-slot",
      },
      {
        type: "WIN",
        reason: "RESIGNATION",
        winnerSlotId: "slot-a",
        resignedSlotId: "slot-a",
      },
    ])
      expect(gomokuPlayViewSchema.safeParse({ ...view, outcome }).success).toBe(
        false,
      );
  });
});
import { setupNotice } from "../src/setup-ui";

describe("Setup feedback", () => {
  it("distinguishes permissions, stale settings, and failed connections without exposing codes", () => {
    expect(setupNotice("accepted")).toBeNull();
    expect(setupNotice("stale")).toContain("设置已被更新");
    expect(setupNotice("rejected", "NOT_OWNER")).toContain("只有房主");
    expect(setupNotice("rejected", "HOST_REJECTED")).toContain("连接");
    expect(setupNotice("rejected", "UNKNOWN_INTERNAL_CODE")).not.toContain(
      "UNKNOWN_INTERNAL_CODE",
    );
  });
});
