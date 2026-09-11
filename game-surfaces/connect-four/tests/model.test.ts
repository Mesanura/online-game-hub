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
  resultSummary,
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
    const partial = [...emptyBoard];
    partial[38] = "slot-a";
    expect(landingCell(partial, 3)).toBe(31);
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
    expect(resultSummary(view)).toEqual({ tone: "win", headline: "你获胜" });
    expect(
      connectFourPlayViewSchema.safeParse({ ...view, rngSeed: "secret" })
        .success,
    ).toBe(false);
    for (const invalid of [
      { ...view, nextPlayerIndex: 0 },
      { ...view, board: [null] },
      { ...view, yourDisc: "BLUE" },
      { ...view, board: [...view.board.slice(0, -1), "unknown-slot"] },
      { ...view, nextTurnSlotId: "unknown-slot" },
      {
        ...view,
        players: [
          { slotId: "slot-a", disc: "RED" },
          { slotId: "slot-a", disc: "YELLOW" },
        ],
      },
      { ...view, outcome: { ...view.outcome, winnerSlotId: "unknown-slot" } },
      {
        ...view,
        outcome: {
          type: "WIN",
          reason: "RESIGNATION",
          winnerSlotId: "slot-a",
          resignedSlotId: "unknown-slot",
        },
      },
      {
        ...view,
        outcome: {
          type: "WIN",
          reason: "RESIGNATION",
          winnerSlotId: "slot-a",
          resignedSlotId: "slot-a",
        },
      },
    ]) {
      expect(connectFourPlayViewSchema.safeParse(invalid).success).toBe(false);
    }
    const draw = connectFourPlayViewSchema.parse({
      ...view,
      outcome: { type: "DRAW" },
    });
    expect(outcomeLabel(draw)).toBe("本局平局");
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
