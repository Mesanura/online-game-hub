import { describe, expect, it } from "vitest";

import { surfaceHostMessageSchema } from "@online-game-hub/game-surface-bridge";

import {
  ticTacToeHistoricalPlayViewSchema,
  ticTacToeHistoricalPlayIntentSchema,
  ticTacToePlayIntentSchema,
  ticTacToePlayViewSchema,
  ticTacToeSetupIntentSchema,
  ticTacToeSetupViewSchema,
} from "../src/contracts";
import {
  createPlayIntent,
  createResignIntent,
  createSetupIntent,
  markForSlot,
  playStatusLabel,
  resultSummary,
  setupStatusLabel,
} from "../src/model";

const playView = ticTacToePlayViewSchema.parse({
  players: [
    { slotId: "slot-a", mark: "X" },
    { slotId: "slot-b", mark: "O" },
  ],
  board: ["slot-a", "slot-b", null, null, "slot-a", null, null, null, null],
  nextTurnSlotId: "slot-a",
  outcome: null,
  yourMark: "X",
});

describe("Tic-Tac-Toe Surface model", () => {
  it("accepts only strict projected Setup views and minimal Setup intents", () => {
    const setup = ticTacToeSetupViewSchema.parse({
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
      participantSlotIds: ["slot-a", "slot-b"],
      canEdit: true,
    });
    expect(setupStatusLabel(setup)).toBe("请选择本局先手");
    expect(
      ticTacToeSetupIntentSchema.parse(createSetupIntent("RANDOM")),
    ).toEqual({ type: "SELECT_STARTER", starter: "RANDOM" });
    expect(
      ticTacToeSetupViewSchema.safeParse({ ...setup, actorSlotId: "slot-a" })
        .success,
    ).toBe(false);
  });

  it("derives marks and turn labels only from projected Play views", () => {
    expect(markForSlot(playView, "slot-b")).toBe("O");
    expect(playStatusLabel(playView)).toBe("轮到你落子");
    expect(ticTacToePlayIntentSchema.parse(createPlayIntent(8))).toEqual({
      type: "PLACE_MARK",
      cell: 8,
    });
    expect(ticTacToePlayIntentSchema.parse(createResignIntent())).toEqual({
      type: "RESIGN",
    });
    expect(
      ticTacToeHistoricalPlayIntentSchema.safeParse(createResignIntent())
        .success,
    ).toBe(false);
  });

  it("renders terminal labels without receiving raw state or actor fields", () => {
    const won = ticTacToePlayViewSchema.parse({
      ...playView,
      nextTurnSlotId: null,
      outcome: {
        type: "WIN",
        winnerSlotId: "slot-a",
        winningCells: [0, 4, 8],
      },
    });
    expect(playStatusLabel(won)).toBe("你赢了");
    expect(resultSummary(won)).toEqual({ tone: "win", headline: "你获胜" });
    expect(ticTacToeHistoricalPlayViewSchema.safeParse(won).success).toBe(true);
    const resigned = {
      ...playView,
      nextTurnSlotId: null,
      outcome: {
        type: "WIN",
        reason: "RESIGNATION",
        winnerSlotId: "slot-a",
        resignedSlotId: "slot-b",
      },
    } as const;
    expect(ticTacToePlayViewSchema.safeParse(resigned).success).toBe(true);
    expect(resultSummary(resigned)).toEqual({
      tone: "win",
      headline: "你获胜",
      details: ["本局因投降结束"],
    });
    expect(ticTacToeHistoricalPlayViewSchema.safeParse(resigned).success).toBe(
      false,
    );
    expect(
      surfaceHostMessageSchema.safeParse({
        type: "surface.intent",
        clientIntentId: "surface-test-1",
        intent: createPlayIntent(2),
      }).success,
    ).toBe(true);
    expect(
      surfaceHostMessageSchema.safeParse({
        type: "surface.intent",
        clientIntentId: "surface-test-2",
        intent: { ...createPlayIntent(2), actorSlotId: "slot-a" },
      }).success,
    ).toBe(false);
  });
});
