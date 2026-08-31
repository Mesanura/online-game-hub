import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  HEX_RESIGN_CONFIRMATION_MESSAGE,
  HexClient,
  confirmHexResignation,
  createPlaceStoneIntent,
  createResignIntent,
  hexClientModule,
  hexViewSchema,
} from "../src/client/index.js";

function createBoard(): (string | null)[] {
  const board = Array<string | null>(121).fill(null);
  board[60] = "slot-blue";
  board[59] = "slot-red";
  return board;
}

const view = {
  players: [
    { slotId: "slot-blue", color: "BLUE" },
    { slotId: "slot-red", color: "RED" },
  ],
  board: createBoard(),
  nextTurnSlotId: "slot-blue",
  outcome: null,
  yourColor: "BLUE",
} as const;

function render(input: unknown = view, connectionState = "connected"): string {
  return renderToStaticMarkup(
    createElement(HexClient, {
      view: hexClientModule.parseView(input),
      revision: 2,
      connectionState: connectionState as "connected",
      submitAction: vi.fn(async () => undefined),
    }),
  );
}

describe("Hex Client Module", () => {
  it("parses a complete client-safe View and rejects malformed or Core-only data", () => {
    expect(hexClientModule.parseView(view)).toEqual(view);
    for (const invalid of [
      { ...view, board: [null] },
      { ...view, nextPlayerIndex: 0 },
      { ...view, resignedSlotId: null },
      {
        ...view,
        board: [...view.board.slice(0, 120), "unknown-slot"],
      },
      { ...view, nextTurnSlotId: "unknown-slot" },
      {
        ...view,
        nextTurnSlotId: null,
        outcome: {
          type: "WIN",
          reason: "RESIGNATION",
          winnerSlotId: "slot-blue",
          resignedSlotId: "slot-blue",
        },
      },
    ]) {
      expect(hexViewSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("creates only minimal placement and resignation intents", () => {
    expect(createPlaceStoneIntent(60)).toEqual({
      type: "PLACE_STONE",
      cell: 60,
    });
    expect(createResignIntent()).toEqual({ type: "RESIGN" });
    for (const intent of [createPlaceStoneIntent(60), createResignIntent()]) {
      expect(intent).not.toHaveProperty("actorSlotId");
      expect(intent).not.toHaveProperty("state");
      expect(intent).not.toHaveProperty("outcome");
      expect(intent).not.toHaveProperty("revision");
      expect(intent).not.toHaveProperty("randomResult");
    }
  });

  it("uses the exact second-confirmation warning and honors confirm/cancel", () => {
    const confirm = vi.fn(() => true);
    const cancel = vi.fn(() => false);
    expect(confirmHexResignation(confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(HEX_RESIGN_CONFIRMATION_MESSAGE);
    expect(confirmHexResignation(cancel)).toBe(false);
    expect(cancel).toHaveBeenCalledWith(HEX_RESIGN_CONFIRMATION_MESSAGE);
  });

  it("renders 121 accessible diamond cells, edge labels, coordinates, turn, and color", () => {
    const html = render();
    expect(html).toContain("11 × 11 棋盘");
    expect(html).toContain("你的棋子：蓝方");
    expect(html).toContain("轮到你落子");
    expect(html).toContain('aria-label="六贯棋棋盘"');
    expect(html).toContain('data-coordinate="K1"');
    expect(html).toContain('data-coordinate="K11"');
    expect(html).toContain('data-coordinate="A1"');
    expect(html).toContain('data-coordinate="A11"');
    expect(html).toContain('aria-label="F6，蓝方"');
    expect(html.match(/data-cell-index=/gu)).toHaveLength(121);
    expect(html.match(/class="hex-coordinate /gu)).toHaveLength(44);
    expect(html).toContain("hex-coordinate-red-top-left");
    expect(html).toContain("hex-coordinate-blue-top-right");
    expect(html).not.toContain("nextPlayerIndex");
  });

  it("renders pieces as empty color-only shapes while retaining text and ARIA descriptions", () => {
    const html = render();
    expect(html).toMatch(
      /data-cell-index="60" data-color="BLUE"[^>]*><span aria-hidden="true" class="hex-piece"><\/span><\/button>/u,
    );
    expect(html).toMatch(
      /data-cell-index="59" data-color="RED"[^>]*><span aria-hidden="true" class="hex-piece"><\/span><\/button>/u,
    );
    expect(html).not.toContain("●");
    expect(html).not.toContain("○");
  });

  it("disables occupied/off-turn/disconnected cells and exposes resignation only to players", () => {
    const html = render();
    expect(html).toMatch(
      /data-cell-index="60" data-color="BLUE"[^>]*disabled=""/u,
    );
    expect(html).not.toMatch(
      /data-cell-index="58" data-color="EMPTY"[^>]*disabled=""/u,
    );
    expect(html).toContain('data-testid="resign-game"');

    const redHtml = render({ ...view, yourColor: "RED" });
    expect(redHtml).toMatch(
      /data-cell-index="58" data-color="EMPTY"[^>]*disabled=""/u,
    );
    expect(redHtml).not.toMatch(/data-testid="resign-game" disabled=""/u);

    const spectatorHtml = render({ ...view, yourColor: null });
    expect(spectatorHtml).not.toContain('data-testid="resign-game"');
  });

  it("marks only a connection path for glow and never glows a resignation outcome", () => {
    const connectionPath = Array.from({ length: 11 }, (_, row) => row * 11);
    const connectionBoard = Array<string | null>(121).fill(null);
    for (const cell of connectionPath) connectionBoard[cell] = "slot-blue";
    const connectionHtml = render({
      ...view,
      board: connectionBoard,
      nextTurnSlotId: null,
      outcome: {
        type: "WIN",
        reason: "CONNECTION",
        winnerSlotId: "slot-blue",
        winningPath: connectionPath,
      },
    });
    expect(connectionHtml.match(/ winning-cell/gu)).toHaveLength(11);
    expect(connectionHtml).toContain("已连通对应两边");

    const resignationHtml = render({
      ...view,
      nextTurnSlotId: null,
      outcome: {
        type: "WIN",
        reason: "RESIGNATION",
        winnerSlotId: "slot-blue",
        resignedSlotId: "slot-red",
      },
    });
    expect(resignationHtml).not.toContain("winning-cell");
    expect(resignationHtml).toContain("对手投降");
  });
});
