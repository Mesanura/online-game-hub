import { describe, expect, it } from "vitest";

import { surfaceHostMessageSchema } from "@online-game-hub/game-surface-bridge";

import {
  reversiPlayIntentSchema,
  reversiHistoricalPlayIntentSchema,
  reversiPlayViewSchema,
  reversiSetupIntentSchema,
  reversiSetupViewSchema,
} from "../src/contracts";
import {
  coordinateLabel,
  createPlaceDiscIntent,
  createResignIntent,
  createSetupIntent,
  outcomeLabel,
  resultSummary,
  setupStatusLabel,
} from "../src/model";

function initialBoard(): (string | null)[] {
  const board = Array<string | null>(64).fill(null);
  board[27] = "slot-white";
  board[36] = "slot-white";
  board[28] = "slot-black";
  board[35] = "slot-black";
  return board;
}

describe("Reversi Surface model", () => {
  it("accepts strict setup projection and minimal starter intent", () => {
    const setup = reversiSetupViewSchema.parse({
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
      participantSlotIds: ["slot-black", "slot-white"],
      canEdit: true,
    });
    expect(setupStatusLabel(setup)).toBe("请选择本局黑棋玩家");
    expect(reversiSetupIntentSchema.parse(createSetupIntent("OWNER"))).toEqual({
      type: "SELECT_STARTER",
      starter: "OWNER",
    });
  });

  it("uses only server-provided legal moves and creates a minimal intent", () => {
    expect(coordinateLabel(19)).toBe("D3");
    expect(reversiPlayIntentSchema.parse(createPlaceDiscIntent(19))).toEqual({
      type: "PLACE_DISC",
      cell: 19,
    });
    expect(reversiPlayIntentSchema.parse(createResignIntent())).toEqual({
      type: "RESIGN",
    });
    expect(
      reversiHistoricalPlayIntentSchema.safeParse(createResignIntent()).success,
    ).toBe(false);
    expect(
      surfaceHostMessageSchema.safeParse({
        type: "surface.intent",
        clientIntentId: "reversi-1",
        intent: { ...createPlaceDiscIntent(19), actor: "slot-black" },
      }).success,
    ).toBe(false);
  });

  it("parses the projected board, counts, and current outcome", () => {
    const view = reversiPlayViewSchema.parse({
      players: [
        { slotId: "slot-black", disc: "BLACK" },
        { slotId: "slot-white", disc: "WHITE" },
      ],
      board: initialBoard(),
      nextTurnSlotId: "slot-black",
      legalMoves: [19, 26, 37, 44],
      discCounts: { BLACK: 2, WHITE: 2 },
      outcome: null,
      yourDisc: "BLACK",
    });
    expect(view.legalMoves).toEqual([19, 26, 37, 44]);
    // The projection chooses legal moves; the Surface must not rescan captures.
    expect(
      reversiPlayViewSchema.parse({ ...view, legalMoves: [19] }).legalMoves,
    ).toEqual([19]);
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
    ])
      expect(reversiPlayViewSchema.safeParse(invalid).success).toBe(false);
    const terminal = reversiPlayViewSchema.parse({
      ...view,
      board: Array.from({ length: 64 }, (_, cell) =>
        cell < 15 ? "slot-black" : null,
      ),
      nextTurnSlotId: null,
      legalMoves: [],
      discCounts: { BLACK: 15, WHITE: 0 },
      outcome: {
        type: "WIN",
        winnerSlotId: "slot-black",
        discCounts: { BLACK: 15, WHITE: 0 },
      },
    });
    expect(outcomeLabel(terminal)).toBe("胜者：你（黑方，15 比 0）");
    expect(resultSummary(terminal)).toEqual({
      tone: "win",
      headline: "你获胜",
      details: ["黑方 15 · 白方 0"],
    });
    expect(
      reversiPlayViewSchema.safeParse({ ...view, rawState: {} }).success,
    ).toBe(false);
    expect(
      reversiPlayViewSchema.safeParse({
        ...terminal,
        outcome: { ...terminal.outcome, winnerSlotId: "slot-white" },
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
