import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  GomokuClient,
  createPlaceStoneIntent,
  gomokuClientModule,
  gomokuViewSchema,
} from "../src/client/module.js";

function createBoard(boardSize: 15 | 19): (string | null)[] {
  const board = Array<string | null>(boardSize * boardSize).fill(null);
  const center = Math.floor(board.length / 2);
  board[center] = "slot-black";
  board[center - 1] = "slot-white";
  return board;
}

const view = {
  boardSize: 15,
  winLength: 5,
  players: [
    { slotId: "slot-black", stone: "BLACK" },
    { slotId: "slot-white", stone: "WHITE" },
  ],
  board: createBoard(15),
  nextTurnSlotId: "slot-black",
  outcome: null,
  yourStone: "BLACK",
} as const;

describe("Gomoku Client Module", () => {
  it("parses complete client-safe 15 × 15 and 19 × 19 Views", () => {
    expect(gomokuClientModule.parseView(view)).toEqual(view);
    const largeView = {
      ...view,
      boardSize: 19,
      board: createBoard(19),
    } as const;
    expect(gomokuClientModule.parseView(largeView)).toEqual(largeView);
  });

  it("rejects mismatched boards, Core-only fields, unknown owners, and invalid win metadata", () => {
    expect(
      gomokuViewSchema.safeParse({ ...view, nextPlayerIndex: 0 }).success,
    ).toBe(false);
    expect(gomokuViewSchema.safeParse({ ...view, board: [null] }).success).toBe(
      false,
    );
    expect(
      gomokuViewSchema.safeParse({
        ...view,
        board: [...view.board.slice(0, 224), "unknown-slot"],
      }).success,
    ).toBe(false);
    expect(gomokuViewSchema.safeParse({ ...view, winLength: 6 }).success).toBe(
      false,
    );
    expect(
      gomokuViewSchema.safeParse({
        ...view,
        nextTurnSlotId: null,
        outcome: {
          type: "WIN",
          winnerSlotId: "slot-black",
          winningCells: [221, 222, 223, 224, 225],
        },
      }).success,
    ).toBe(false);
  });

  it("creates only the selected-cell intent", () => {
    const intent = createPlaceStoneIntent(112);
    expect(intent).toEqual({ type: "PLACE_STONE", cell: 112 });
    expect(intent).not.toHaveProperty("actorSlotId");
    expect(intent).not.toHaveProperty("state");
    expect(intent).not.toHaveProperty("outcome");
    expect(intent).not.toHaveProperty("revision");
    expect(intent).not.toHaveProperty("randomResult");
  });

  it("exposes and parses strict resignation support", () => {
    expect(gomokuClientModule.createResignAction?.()).toEqual({
      type: "RESIGN",
    });
    expect(
      gomokuViewSchema.safeParse({
        ...view,
        nextTurnSlotId: null,
        outcome: {
          type: "WIN",
          reason: "RESIGNATION",
          winnerSlotId: "slot-black",
          resignedSlotId: "slot-white",
        },
      }).success,
    ).toBe(true);
  });

  it("renders an accessible 15 × 15 board, turn, and clay stones", () => {
    const html = renderToStaticMarkup(
      createElement(GomokuClient, {
        view: gomokuClientModule.parseView(view),
        revision: 2,
        connectionState: "connected",
        submitAction: vi.fn(async () => undefined),
      }),
    );
    expect(html).not.toContain("15 × 15 棋盘");
    expect(html).toContain("你的棋子：黑方");
    expect(html).toContain("轮到你落子");
    expect(html.match(/class="game-status-dot"/gu)).toHaveLength(2);
    expect(html).toContain('data-color="BLACK"');
    expect(html).toContain('aria-label="五子棋棋盘"');
    expect(html).toContain('aria-label="第 8 行第 8 列，黑方"');
    expect(html.match(/data-cell-index=/gu)).toHaveLength(225);
    expect(html).toMatch(
      /data-cell-index="112" data-stone="BLACK"[^>]*><span aria-hidden="true" class="gomoku-stone" data-stone-color="BLACK"><\/span><\/button>/u,
    );
    expect(html).not.toContain("nextPlayerIndex");
  });

  it("renders all 361 cells for a 19 × 19 View", () => {
    const html = renderToStaticMarkup(
      createElement(GomokuClient, {
        view: gomokuClientModule.parseView({
          ...view,
          boardSize: 19,
          board: createBoard(19),
        }),
        revision: 2,
        connectionState: "connected",
        submitAction: vi.fn(async () => undefined),
      }),
    );
    expect(html).not.toContain("19 × 19 棋盘");
    expect(html.match(/data-cell-index=/gu)).toHaveLength(361);
  });

  it("disables occupied cells as a View-derived affordance", () => {
    const html = renderToStaticMarkup(
      createElement(GomokuClient, {
        view: gomokuClientModule.parseView(view),
        revision: 2,
        connectionState: "connected",
        submitAction: vi.fn(async () => undefined),
      }),
    );
    expect(html).toMatch(
      /data-cell-index="112" data-stone="BLACK" disabled=""/u,
    );
    expect(html).not.toMatch(
      /data-cell-index="110" data-stone="EMPTY" disabled=""/u,
    );
  });

  it.each([
    [{ type: "DRAW" }, "平局"],
    [
      {
        type: "WIN",
        winnerSlotId: "slot-black",
        winningCells: [108, 109, 110, 111, 112],
      },
      "胜者：你",
    ],
  ] as const)("renders authoritative terminal outcome %#", (outcome, label) => {
    const terminalView = gomokuClientModule.parseView({
      ...view,
      nextTurnSlotId: null,
      outcome,
    });
    const html = renderToStaticMarkup(
      createElement(GomokuClient, {
        view: terminalView,
        revision: 225,
        connectionState: "connected",
        submitAction: vi.fn(async () => undefined),
      }),
    );
    expect(html).toContain(label);
  });
});
