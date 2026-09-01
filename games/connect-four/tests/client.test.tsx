import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ConnectFourClient,
  connectFourClientModule,
  connectFourViewSchema,
  createDropDiscIntent,
  lowestOpenCellInColumn,
} from "../src/client/module.js";
import { CONNECT_FOUR_CELL_COUNT } from "../src/constants.js";

function createBoard(): (string | null)[] {
  const board = Array<string | null>(CONNECT_FOUR_CELL_COUNT).fill(null);
  board[35] = "slot-red";
  board[36] = "slot-red";
  board[37] = "slot-red";
  board[39] = "slot-yellow";
  return board;
}

const view = {
  players: [
    { slotId: "slot-red", disc: "RED" },
    { slotId: "slot-yellow", disc: "YELLOW" },
  ],
  board: createBoard(),
  nextTurnSlotId: "slot-red",
  outcome: null,
  yourDisc: "RED",
} as const;

describe("Connect Four Client Module", () => {
  it("parses only a complete client-safe View", () => {
    expect(connectFourClientModule.parseView(view)).toEqual(view);
    expect(
      connectFourViewSchema.safeParse({ ...view, nextPlayerIndex: 0 }).success,
    ).toBe(false);
    expect(
      connectFourViewSchema.safeParse({ ...view, board: [null] }).success,
    ).toBe(false);
    expect(
      connectFourViewSchema.safeParse({
        ...view,
        board: [...view.board.slice(0, 41), "unknown-slot"],
      }).success,
    ).toBe(false);
    expect(
      connectFourViewSchema.safeParse({ ...view, yourDisc: "BLUE" }).success,
    ).toBe(false);
  });

  it("creates only the selected-column intent", () => {
    const intent = createDropDiscIntent(4);
    expect(intent).toEqual({ type: "DROP_DISC", column: 4 });
    expect(intent).not.toHaveProperty("actorSlotId");
    expect(intent).not.toHaveProperty("row");
    expect(intent).not.toHaveProperty("state");
    expect(intent).not.toHaveProperty("outcome");
  });

  it("exposes and parses strict resignation support", () => {
    expect(connectFourClientModule.createResignAction?.()).toEqual({
      type: "RESIGN",
    });
    expect(
      connectFourViewSchema.safeParse({
        ...view,
        nextTurnSlotId: null,
        outcome: {
          type: "WIN",
          reason: "RESIGNATION",
          winnerSlotId: "slot-red",
          resignedSlotId: "slot-yellow",
        },
      }).success,
    ).toBe(true);
  });

  it("derives a column preview from the lowest empty View cell", () => {
    const board = createBoard();
    expect(lowestOpenCellInColumn(board, 0)).toBe(28);
    expect(lowestOpenCellInColumn(board, 3)).toBe(38);
    for (let row = 0; row < 6; row += 1) {
      board[row * 7 + 4] = row % 2 === 0 ? "slot-red" : "slot-yellow";
    }
    expect(lowestOpenCellInColumn(board, 4)).toBeNull();
  });

  it("renders seven accessible column controls, 42 cells, turn, and disc", () => {
    const html = renderToStaticMarkup(
      createElement(ConnectFourClient, {
        view: connectFourClientModule.parseView(view),
        revision: 4,
        connectionState: "connected",
        submitAction: vi.fn(async () => undefined),
      }),
    );
    expect(html).toContain("你的棋子：红方");
    expect(html).toContain("轮到你选择一列");
    expect(html.match(/class="game-status-dot"/gu)).toHaveLength(2);
    expect(html).toContain('data-color="RED"');
    expect(html.match(/data-column-index=/gu)).toHaveLength(7);
    expect(html.match(/data-cell-index=/gu)).toHaveLength(42);
    expect(html).toContain('aria-label="第 7 列落子"');
    expect(html).toContain('data-preview="false"');
    expect(html).not.toContain("7 × 6 棋盘");
    expect(html).not.toContain("nextPlayerIndex");
  });

  it("disables a full column as a View-derived affordance", () => {
    const board = createBoard();
    for (let row = 0; row < 6; row += 1) {
      board[row * 7 + 2] = row % 2 === 0 ? "slot-yellow" : "slot-red";
    }
    const html = renderToStaticMarkup(
      createElement(ConnectFourClient, {
        view: connectFourClientModule.parseView({ ...view, board }),
        revision: 10,
        connectionState: "connected",
        submitAction: vi.fn(async () => undefined),
      }),
    );
    expect(html).toMatch(/data-column-index="2" disabled=""/u);
    expect(html).not.toMatch(/data-column-index="1" disabled=""/u);
  });

  it.each([
    [{ type: "DRAW" }, "平局"],
    [
      {
        type: "WIN",
        winnerSlotId: "slot-red",
        winningCells: [35, 36, 37, 38],
      },
      "胜者：你",
    ],
  ] as const)("renders authoritative terminal outcome %#", (outcome, label) => {
    const terminalView = connectFourClientModule.parseView({
      ...view,
      nextTurnSlotId: null,
      outcome,
    });
    const html = renderToStaticMarkup(
      createElement(ConnectFourClient, {
        view: terminalView,
        revision: outcome.type === "DRAW" ? 42 : 7,
        connectionState: "connected",
        submitAction: vi.fn(async () => undefined),
      }),
    );
    expect(html).toContain(label);
  });
});
