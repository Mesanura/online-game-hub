import { describe, expect, it } from "vitest";

import { surfaceHostMessageSchema } from "@online-game-hub/game-surface-bridge";

import {
  HEX_CELL_COUNT,
  hexPlayIntentSchema,
  hexPlayViewSchema,
  hexSetupIntentSchema,
  hexSetupViewSchema,
} from "../src/contracts";
import {
  coordinateLabel,
  createPlaceStoneIntent,
  createResignIntent,
  createSetupIntent,
  layoutForCell,
  outcomeLabel,
  resultSummary,
  setupStatusLabel,
} from "../src/model";

const players = [
  { slotId: "slot-blue", color: "BLUE" },
  { slotId: "slot-red", color: "RED" },
] as const;

describe("Hex Surface model", () => {
  it("rejects malformed projections, private fields and invalid slot references", () => {
    const view = {
      players,
      board: Array<string | null>(121).fill(null),
      nextTurnSlotId: "slot-blue",
      outcome: null,
      yourColor: "BLUE",
    };
    expect(hexPlayViewSchema.parse(view)).toEqual(view);
    for (const invalid of [
      { ...view, board: [null] },
      { ...view, nextPlayerIndex: 0 },
      { ...view, resignedSlotId: null },
      { ...view, board: [...view.board.slice(0, 120), "unknown-slot"] },
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
    ])
      expect(hexPlayViewSchema.safeParse(invalid).success).toBe(false);
  });

  it("makes exactly the six rule neighbors share a visual side across the entire board", () => {
    const offsets = [
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
    ] as const;
    const vertices = Array.from({ length: 121 }, (_, cell) => {
      const { x, y } = layoutForCell(cell);
      return new Set(
        [
          [-0.25, -0.5],
          [0.25, -0.5],
          [0.5, 0],
          [0.25, 0.5],
          [-0.25, 0.5],
          [-0.5, 0],
        ].map(([dx = 0, dy = 0]) => `${x + dx}:${y + dy}`),
      );
    });
    for (const [cell, polygon] of vertices.entries()) {
      const row = Math.floor(cell / 11),
        column = cell % 11;
      const expected = new Set(
        offsets.flatMap(([dr, dc]) => {
          const r = row + dr,
            c = column + dc;
          return r >= 0 && r < 11 && c >= 0 && c < 11 ? [r * 11 + c] : [];
        }),
      );
      const actual = new Set(
        vertices.flatMap((candidate, index) =>
          [...candidate].filter((vertex) => polygon.has(vertex)).length === 2
            ? [index]
            : [],
        ),
      );
      expect(actual).toEqual(expected);
    }
  });

  it("accepts strict setup projection and minimal starter intent", () => {
    const setup = hexSetupViewSchema.parse({
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
      participantSlotIds: ["slot-blue", "slot-red"],
      canEdit: true,
    });
    expect(setupStatusLabel(setup)).toBe("请选择本局蓝方玩家");
    expect(hexSetupIntentSchema.parse(createSetupIntent("OWNER"))).toEqual({
      type: "SELECT_STARTER",
      starter: "OWNER",
    });
  });

  it("preserves the rhombus coordinates and creates a minimal play intent", () => {
    expect(coordinateLabel(0)).toBe("A1");
    expect(coordinateLabel(120)).toBe("K11");
    expect(layoutForCell(1)).toMatchObject({ x: 0.75, y: 0.5 });
    expect(layoutForCell(11)).toMatchObject({ x: 0.75, y: -0.5 });
    expect(hexPlayIntentSchema.parse(createPlaceStoneIntent(55))).toEqual({
      type: "PLACE_STONE",
      cell: 55,
    });
    expect(hexPlayIntentSchema.parse(createResignIntent())).toEqual({
      type: "RESIGN",
    });
    expect(
      surfaceHostMessageSchema.safeParse({
        type: "surface.intent",
        clientIntentId: "hex-1",
        intent: { ...createPlaceStoneIntent(55), actor: "slot-blue" },
      }).success,
    ).toBe(false);
  });

  it("accepts only a server-projected, connected winner-owned path", () => {
    const board = Array<string | null>(HEX_CELL_COUNT).fill(null);
    const winningPath = Array.from({ length: 11 }, (_, row) => row * 11);
    for (const cell of winningPath) board[cell] = "slot-blue";
    const view = hexPlayViewSchema.parse({
      players,
      board,
      nextTurnSlotId: null,
      outcome: {
        type: "WIN",
        reason: "CONNECTION",
        winnerSlotId: "slot-blue",
        winningPath,
      },
      yourColor: "BLUE",
    });
    expect(outcomeLabel(view)).toContain("胜者：你");
    expect(resultSummary(view)).toEqual({
      tone: "win",
      headline: "你获胜",
      details: ["胜方已连通对应两边"],
    });
    expect(hexPlayViewSchema.safeParse({ ...view, rawState: {} }).success).toBe(
      false,
    );
    expect(
      hexPlayViewSchema.safeParse({
        ...view,
        outcome: { ...view.outcome, winningPath: [0, 11, 33] },
      }).success,
    ).toBe(false);
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
