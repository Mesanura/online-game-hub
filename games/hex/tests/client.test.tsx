import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  HexClient,
  createPlaceStoneIntent,
  createResignIntent,
  hexClientModule,
  hexViewSchema,
} from "../src/client/index.js";
import {
  hexCellsShareSide,
  hexEdgeBandPath,
  hexLayoutForCell,
} from "../src/client/module.js";

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

  it("maps all three Hex axes to the horizontal flat-top visual layout", () => {
    expect(hexLayoutForCell(0)).toMatchObject({
      row: 0,
      column: 0,
      x: 0,
      y: 0,
      style: { gridColumn: "1 / span 4", gridRow: "11 / span 2" },
    });
    expect(hexLayoutForCell(1)).toMatchObject({ x: 0.75, y: 0.5 });
    expect(hexLayoutForCell(11)).toMatchObject({ x: 0.75, y: -0.5 });
    expect(hexLayoutForCell(12)).toMatchObject({ x: 1.5, y: 0 });
    expect(hexLayoutForCell(120)).toMatchObject({
      row: 10,
      column: 10,
      x: 15,
      y: 0,
      style: { gridColumn: "61 / span 4", gridRow: "11 / span 2" },
    });
    expect(hexEdgeBandPath("upper-left")).toBe(
      "M 0,550 L 25,500 L 75,500 L 100,450 L 150,450 L 175,400 L 225,400 L 250,350 L 300,350 L 325,300 L 375,300 L 400,250 L 450,250 L 475,200 L 525,200 L 550,150 L 600,150 L 625,100 L 675,100 L 700,50 L 750,50 L 775,0 L 825,0",
    );
  });

  it("makes all and only the six Core neighbors share a visual side", () => {
    const coreOffsets = [
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
    ] as const;
    for (let cell = 0; cell < 121; cell += 1) {
      const row = Math.floor(cell / 11);
      const column = cell % 11;
      const expected = new Set<number>();
      for (const [rowOffset, columnOffset] of coreOffsets) {
        const neighborRow = row + rowOffset;
        const neighborColumn = column + columnOffset;
        if (
          neighborRow >= 0 &&
          neighborRow < 11 &&
          neighborColumn >= 0 &&
          neighborColumn < 11
        ) {
          expected.add(neighborRow * 11 + neighborColumn);
        }
      }
      const actual = new Set(
        Array.from({ length: 121 }, (_, candidate) => candidate).filter(
          (candidate) =>
            candidate !== cell && hexCellsShareSide(cell, candidate),
        ),
      );
      expect(actual).toEqual(expected);
    }
  });

  it("renders 121 accessible regular hex cells, edge labels, coordinates, turn, and color", () => {
    const html = render();
    expect(html).not.toContain("11 × 11 棋盘");
    expect(html).toContain("你的棋子：蓝方");
    expect(html).toContain("轮到你落子");
    expect(html.match(/class="game-status-dot"/gu)).toHaveLength(2);
    expect(html).toContain('data-color="BLUE"');
    expect(html).toContain('aria-label="六贯棋棋盘"');
    expect(html).toContain('data-coordinate="A1"');
    expect(html).toContain('data-coordinate="A11"');
    expect(html).toContain('data-coordinate="K1"');
    expect(html).toContain('data-coordinate="K11"');
    expect(html).toContain('aria-label="F6，蓝方"');
    expect(html.match(/data-cell-index=/gu)).toHaveLength(121);
    expect(html.match(/class="hex-coordinate /gu)).toHaveLength(44);
    expect(html).toContain("hex-coordinate-upper-left");
    expect(html).toContain("hex-coordinate-upper-right");
    expect(html).toContain("hex-coordinate-lower-right");
    expect(html).toContain("hex-coordinate-lower-left");
    expect(html.match(/class="hex-edge-band /gu)).toHaveLength(4);
    expect(html).toMatch(
      /data-cell-index="1"[^>]*data-layout-x="0\.75"[^>]*data-layout-y="0\.5"/u,
    );
    expect(html).toMatch(
      /data-cell-index="11"[^>]*data-layout-x="0\.75"[^>]*data-layout-y="-0\.5"/u,
    );
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

  it("disables occupied/off-turn cells and delegates resignation to the shared host", () => {
    const html = render();
    expect(html).toMatch(
      /data-cell-index="60" data-color="BLUE"[^>]*disabled=""/u,
    );
    expect(html).not.toMatch(
      /data-cell-index="58" data-color="EMPTY"[^>]*disabled=""/u,
    );
    expect(html).not.toContain('data-testid="resign-game"');
    expect(hexClientModule.createResignAction?.()).toEqual({ type: "RESIGN" });

    const redHtml = render({ ...view, yourColor: "RED" });
    expect(redHtml).toMatch(
      /data-cell-index="58" data-color="EMPTY"[^>]*disabled=""/u,
    );
    expect(redHtml).not.toContain('data-testid="resign-game"');

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
