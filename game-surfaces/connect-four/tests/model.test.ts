import { describe, expect, it } from "vitest";

import { surfaceHostMessageSchema } from "@online-game-hub/game-surface-bridge";

import {
  connectFourPlayIntentSchema,
  connectFourHistoricalPlayIntentSchema,
  connectFourPlayViewSchema,
  connectFourSetupIntentSchema,
  connectFourSetupViewSchema,
} from "../src/contracts";
import {
  createDropDiscIntent,
  createResignIntent,
  createSetupIntent,
  landingCell,
  outcomeLabel,
  setupStatusLabel,
} from "../src/model";

const emptyBoard: (string | null)[] = Array.from({ length: 42 }, () => null);

describe("Connect Four Surface model", () => {
  it("accepts only projected setup views and minimal setup intents", () => {
    const setup = connectFourSetupViewSchema.parse({
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
      participantSlotIds: ["slot-a", "slot-b"],
      canEdit: true,
    });
    expect(setupStatusLabel(setup)).toBe("请选择本局先手");
    expect(
      connectFourSetupIntentSchema.parse(createSetupIntent("RANDOM")),
    ).toEqual({ type: "SELECT_STARTER", starter: "RANDOM" });
    expect(
      connectFourSetupViewSchema.safeParse({ ...setup, actor: "slot-a" })
        .success,
    ).toBe(false);
  });

  it("creates only column intents and calculates the visible landing cell", () => {
    expect(connectFourPlayIntentSchema.parse(createDropDiscIntent(3))).toEqual({
      type: "DROP_DISC",
      column: 3,
    });
    expect(landingCell(emptyBoard, 3)).toBe(38);
    const filled = [...emptyBoard];
    for (const cell of [3, 10, 17, 24, 31, 38]) filled[cell] = "slot-a";
    expect(landingCell(filled, 3)).toBeNull();
    expect(connectFourPlayIntentSchema.parse(createResignIntent())).toEqual({
      type: "RESIGN",
    });
    expect(
      connectFourHistoricalPlayIntentSchema.safeParse(createResignIntent())
        .success,
    ).toBe(false);
    expect(
      surfaceHostMessageSchema.safeParse({
        type: "surface.intent",
        clientIntentId: "drop-1",
        intent: { ...createDropDiscIntent(3), actor: "slot-a" },
      }).success,
    ).toBe(false);
  });

  it("parses historical and current projected outcomes", () => {
    const view = connectFourPlayViewSchema.parse({
      players: [
        { slotId: "slot-a", disc: "RED" },
        { slotId: "slot-b", disc: "YELLOW" },
      ],
      board: emptyBoard,
      nextTurnSlotId: null,
      outcome: {
        type: "WIN",
        winnerSlotId: "slot-a",
        winningCells: [35, 36, 37, 38],
      },
      yourDisc: "RED",
    });
    expect(outcomeLabel(view)).toBe("你赢了");
    expect(
      connectFourPlayViewSchema.safeParse({ ...view, rngSeed: "secret" })
        .success,
    ).toBe(false);
  });
});
