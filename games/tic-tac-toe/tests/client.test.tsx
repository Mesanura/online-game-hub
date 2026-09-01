import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  TicTacToeClient,
  ticTacToeClientModule,
  ticTacToeViewSchema,
} from "../src/client/module.js";

const view = {
  players: [
    { slotId: "slot-1", mark: "X" },
    { slotId: "slot-2", mark: "O" },
  ],
  board: ["slot-1", null, null, null, "slot-2", null, null, null, null],
  nextTurnSlotId: "slot-1",
  outcome: null,
  yourMark: "X",
} as const;

describe("Tic-Tac-Toe Client Module", () => {
  it("parses only the complete client-safe View contract", () => {
    expect(ticTacToeClientModule.parseView(view)).toEqual(view);
    expect(
      ticTacToeViewSchema.safeParse({ ...view, nextPlayerIndex: 0 }).success,
    ).toBe(false);
    expect(
      ticTacToeViewSchema.safeParse({ ...view, board: [null] }).success,
    ).toBe(false);
    expect(
      ticTacToeViewSchema.safeParse({ ...view, yourMark: "Z" }).success,
    ).toBe(false);
  });

  it("exposes a strict resignation action factory", () => {
    expect(ticTacToeClientModule.createResignAction?.()).toEqual({
      type: "RESIGN",
    });
    expect(
      ticTacToeViewSchema.safeParse({
        ...view,
        nextTurnSlotId: null,
        outcome: {
          type: "WIN",
          reason: "RESIGNATION",
          winnerSlotId: "slot-1",
          resignedSlotId: "slot-2",
        },
      }).success,
    ).toBe(true);
  });

  it("renders the board, player mark, and turn", () => {
    const html = renderToStaticMarkup(
      createElement(TicTacToeClient, {
        view: ticTacToeClientModule.parseView(view),
        revision: 2,
        connectionState: "connected",
        submitAction: vi.fn(async () => undefined),
      }),
    );
    expect(html).toContain("你的棋子：X");
    expect(html).toContain("轮到你落子");
    expect(html).not.toContain("3 × 3 棋盘");
    expect(html.match(/data-cell-index=/gu)).toHaveLength(9);
    expect(html).not.toContain("nextPlayerIndex");
  });

  it.each([
    [{ type: "DRAW" }, "平局"],
    [
      { type: "WIN", winnerSlotId: "slot-1", winningCells: [0, 1, 2] },
      "胜者：你",
    ],
  ] as const)("renders terminal outcome %#", (outcome, label) => {
    const terminalView = ticTacToeClientModule.parseView({
      ...view,
      board:
        outcome.type === "DRAW"
          ? [
              "slot-1",
              "slot-2",
              "slot-1",
              "slot-1",
              "slot-2",
              "slot-2",
              "slot-2",
              "slot-1",
              "slot-1",
            ]
          : [
              "slot-1",
              "slot-1",
              "slot-1",
              null,
              "slot-2",
              null,
              null,
              null,
              null,
            ],
      nextTurnSlotId: null,
      outcome,
    });
    const html = renderToStaticMarkup(
      createElement(TicTacToeClient, {
        view: terminalView,
        revision: outcome.type === "DRAW" ? 9 : 5,
        connectionState: "connected",
        submitAction: vi.fn(async () => undefined),
      }),
    );
    expect(html).toContain(label);
  });
});
