import { describe, expect, it } from "vitest";

import { surfaceHostMessageSchema } from "@online-game-hub/game-surface-bridge";

import {
  pongPlayIntentSchema,
  pongPlayViewSchema,
  pongSetupIntentSchema,
  pongSetupViewSchema,
} from "../src/contracts";
import {
  createDirectionIntent,
  createResignIntent,
  createSetupIntent,
  interpolationAlpha,
  lerp,
  setupStatusLabel,
  winnerText,
} from "../src/model";

const playView = pongPlayViewSchema.parse({
  field: { width: 800_000, height: 400_000 },
  players: [
    { slotId: "slot-a", side: "LEFT" },
    { slotId: "slot-b", side: "RIGHT" },
  ],
  paddles: [
    { y: 200_000, height: 80_000 },
    { y: 210_000, height: 80_000 },
  ],
  ball: { x: 400_000, y: 200_000, radius: 8_000 },
  scores: [1, 2],
  tick: 60,
  targetScore: 3,
  yourSide: "LEFT",
  outcome: null,
});

describe("Pong Surface model", () => {
  it("accepts strict projected Setup views and minimal Setup intents", () => {
    const setup = pongSetupViewSchema.parse({
      config: { targetScore: 3 },
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
      participantSlotIds: ["slot-a", "slot-b"],
      canEdit: true,
    });
    expect(setupStatusLabel(setup)).toBe("请选择本局发球方");
    expect(pongSetupIntentSchema.parse(createSetupIntent("RANDOM"))).toEqual({
      type: "SELECT_STARTER",
      starter: "RANDOM",
    });
    expect(
      pongSetupViewSchema.safeParse({ ...setup, actorSlotId: "slot-a" })
        .success,
    ).toBe(false);
  });

  it("creates only direction and resignation gameplay intents", () => {
    expect(pongPlayIntentSchema.parse(createDirectionIntent(-1))).toEqual({
      type: "DIRECTION",
      direction: -1,
    });
    expect(pongPlayIntentSchema.parse(createResignIntent())).toEqual({
      type: "RESIGN",
    });
    expect(
      surfaceHostMessageSchema.safeParse({
        type: "surface.intent",
        clientIntentId: "pong-input-1",
        intent: { ...createDirectionIntent(1), inputSequence: 7 },
      }).success,
    ).toBe(false);
  });

  it("interpolates projected frames and disables interpolation for terminal timing", () => {
    expect(interpolationAlpha(1000 / 120)).toBeCloseTo(0.5);
    expect(interpolationAlpha(1000 / 60)).toBe(1);
    expect(lerp(100_000, 200_000, 0.5)).toBe(150_000);
    const won = pongPlayViewSchema.parse({
      ...playView,
      scores: [3, 2],
      outcome: {
        type: "WIN",
        reason: "SCORE",
        winnerSlotId: "slot-a",
        scores: [3, 2],
      },
    });
    expect(winnerText(won)).toBe("你赢了");
  });
});
