import { describe, expect, it } from "vitest";

import { surfaceHostMessageSchema } from "@online-game-hub/game-surface-bridge";

import {
  gomokuPlayIntentSchema,
  gomokuPlayViewSchema,
  gomokuSetupIntentSchema,
  gomokuSetupViewSchema,
} from "../src/contracts";
import {
  createPlaceStoneIntent,
  createSetupIntent,
  outcomeLabel,
  setupStatusLabel,
} from "../src/model";

const emptyBoard: (string | null)[] = Array.from({ length: 225 }, () => null);

describe("Gomoku Surface model", () => {
  it("accepts strict setup projection and minimal starter intent", () => {
    const setup = gomokuSetupViewSchema.parse({
      config: { boardSize: 15, winLength: 5 },
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
      participantSlotIds: ["slot-a", "slot-b"],
      canEdit: true,
    });
    expect(setupStatusLabel(setup)).toBe("请选择本局先手");
    expect(gomokuSetupIntentSchema.parse(createSetupIntent("OWNER"))).toEqual({
      type: "SELECT_STARTER",
      starter: "OWNER",
    });
  });

  it("creates only a cell intent and rejects platform-owned fields", () => {
    expect(gomokuPlayIntentSchema.parse(createPlaceStoneIntent(105))).toEqual({
      type: "PLACE_STONE",
      cell: 105,
    });
    expect(
      gomokuPlayIntentSchema.safeParse({
        ...createPlaceStoneIntent(105),
        expectedRevision: 3,
      }).success,
    ).toBe(false);
    expect(
      surfaceHostMessageSchema.safeParse({
        type: "surface.intent",
        clientIntentId: "gomoku-1",
        intent: { ...createPlaceStoneIntent(105), actor: "slot-a" },
      }).success,
    ).toBe(false);
  });

  it("parses the projected board and both supported outcome generations", () => {
    const view = gomokuPlayViewSchema.parse({
      boardSize: 15,
      winLength: 5,
      players: [
        { slotId: "slot-a", stone: "BLACK" },
        { slotId: "slot-b", stone: "WHITE" },
      ],
      board: emptyBoard,
      nextTurnSlotId: null,
      outcome: {
        type: "WIN",
        winnerSlotId: "slot-a",
        winningCells: [105, 106, 107, 108, 109],
      },
      yourStone: "BLACK",
    });
    expect(outcomeLabel(view)).toBe("你赢了");
    expect(
      gomokuPlayViewSchema.safeParse({ ...view, rawState: {} }).success,
    ).toBe(false);
  });
});
