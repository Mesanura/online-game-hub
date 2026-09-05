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
