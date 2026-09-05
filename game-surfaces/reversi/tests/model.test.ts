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
