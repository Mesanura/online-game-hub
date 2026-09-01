import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ReversiClient,
  createPlaceDiscIntent,
  reversiClientModule,
  reversiViewSchema,
} from "../src/client/index.js";

function createBoard(): (string | null)[] {
  const board = Array<string | null>(64).fill(null);
  board[27] = "slot-white";
  board[36] = "slot-white";
  board[28] = "slot-black";
  board[35] = "slot-black";
  return board;
}

const view = {
  players: [
    { slotId: "slot-black", disc: "BLACK" },
    { slotId: "slot-white", disc: "WHITE" },
  ],
  board: createBoard(),
  nextTurnSlotId: "slot-black",
  legalMoves: [19, 26, 37, 44],
  discCounts: { BLACK: 2, WHITE: 2 },
  outcome: null,
  yourDisc: "BLACK",
} as const;

function render(input: unknown = view, connectionState = "connected"): string {
  return renderToStaticMarkup(
    createElement(ReversiClient, {
      view: reversiClientModule.parseView(input),
      revision: 0,
      connectionState: connectionState as "connected",
      submitAction: vi.fn(async () => undefined),
    }),
  );
}

describe("Reversi Client Module", () => {
  it("parses a complete client-safe View and rejects malformed or Core-only data", () => {
    expect(reversiClientModule.parseView(view)).toEqual(view);
    for (const invalid of [
      { ...view, board: [null] },
      { ...view, nextPlayerIndex: 0 },
      { ...view, board: [...view.board.slice(0, 63), "unknown-slot"] },
      { ...view, nextTurnSlotId: "unknown-slot" },
      { ...view, legalMoves: [19, 19] },
      { ...view, legalMoves: [27] },
      { ...view, discCounts: { BLACK: 3, WHITE: 2 } },
      { ...view, nextTurnSlotId: null },
      { ...view, legalMoves: [] },
      {
        ...view,
        nextTurnSlotId: null,
        legalMoves: [],
        outcome: {
          type: "WIN",
          winnerSlotId: "slot-white",
          discCounts: { BLACK: 2, WHITE: 2 },
        },
      },
    ]) {
      expect(reversiViewSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("creates only the minimal PLACE_DISC intent", () => {
    const intent = createPlaceDiscIntent(19);
    expect(intent).toEqual({ type: "PLACE_DISC", cell: 19 });
    expect(intent).not.toHaveProperty("actorSlotId");
    expect(intent).not.toHaveProperty("state");
    expect(intent).not.toHaveProperty("flips");
    expect(intent).not.toHaveProperty("outcome");
    expect(intent).not.toHaveProperty("revision");
    expect(intent).not.toHaveProperty("randomResult");
  });

  it("renders an accessible responsive 8 × 8 board, stable colors, counts, and server legal moves", () => {
    const html = render();
    expect(html).not.toContain("8 × 8 棋盘");
    expect(html).toContain("你的棋子：黑方");
    expect(html).toContain("轮到你落子");
    expect(html).toContain('aria-label="黑白棋棋盘"');
    expect(html).toContain('data-testid="black-disc-count">黑方：2');
    expect(html).toContain('data-testid="white-disc-count">白方：2');
    expect(html).toContain('data-coordinate="D3"');
    expect(html).toContain('aria-label="D3，空，合法落点"');
    expect(html.match(/data-cell-index=/gu)).toHaveLength(64);
    expect(html.match(/data-legal-move="true"/gu)).toHaveLength(4);
    expect(html.match(/class="reversi-legal-marker"/gu)).toHaveLength(4);
    expect(html).not.toContain("nextPlayerIndex");
  });

  it("enables only server-provided legal moves for the active connected player", () => {
    const html = render();
    expect(html).not.toMatch(
      /data-cell-index="19"[^>]*data-legal-move="true"[^>]*disabled=""/u,
    );
    expect(html).toMatch(
      /data-cell-index="20"[^>]*data-legal-move="false"[^>]*disabled=""/u,
    );
    expect(html).toMatch(
      /data-cell-index="27"[^>]*data-disc="WHITE"[^>]*disabled=""/u,
    );

    const offTurn = render({ ...view, yourDisc: "WHITE" });
    expect(offTurn).toMatch(
      /data-cell-index="19"[^>]*data-legal-move="true"[^>]*disabled=""/u,
    );
    const disconnected = render(view, "reconnecting");
    expect(disconnected).toMatch(
      /data-cell-index="19"[^>]*data-legal-move="true"[^>]*disabled=""/u,
    );
  });

  it("renders discs and server terminal Outcome without recomputing either", () => {
    const html = render();
    expect(html).toMatch(
      /data-cell-index="28"[^>]*data-disc="BLACK"[^>]*><span aria-hidden="true" class="reversi-disc" data-disc-color="BLACK"><\/span>/u,
    );
    expect(html).toMatch(
      /data-cell-index="27"[^>]*data-disc="WHITE"[^>]*><span aria-hidden="true" class="reversi-disc" data-disc-color="WHITE"><\/span>/u,
    );

    const terminalBoard = Array<string | null>(64).fill(null);
    terminalBoard[0] = "slot-black";
    terminalBoard[1] = "slot-black";
    terminalBoard[2] = "slot-black";
    const terminal = render({
      ...view,
      board: terminalBoard,
      nextTurnSlotId: null,
      legalMoves: [],
      discCounts: { BLACK: 3, WHITE: 0 },
      outcome: {
        type: "WIN",
        winnerSlotId: "slot-black",
        discCounts: { BLACK: 3, WHITE: 0 },
      },
    });
    expect(terminal).toContain("胜者：你（黑方，3 比 0）");
    expect(terminal).not.toContain("reversi-legal-marker");
  });
});
