import { describe, expect, it } from "vitest";

import { surfaceHostMessageSchema } from "@online-game-hub/game-surface-bridge";

import {
  parsePlayView,
  PONG_LEGACY_SERVE_DELAY_TICKS,
  PONG_SERVE_DELAY_TICKS,
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
  resultSummary,
  serveArrowVisible,
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
  serve: null,
});

describe("Pong Surface model", () => {
  it("shows exactly two flashes including the first display, then hides before launch", () => {
    const phases: boolean[] = [];
    for (let elapsed = 0; elapsed < PONG_SERVE_DELAY_TICKS; elapsed += 1) {
      const preparing = {
        ...playView,
        serve: {
          ticksRemaining: PONG_SERVE_DELAY_TICKS - elapsed,
          directionX: -1 as const,
          directionY: 1 as const,
        },
      };
      const visible = serveArrowVisible(preparing, false);
      expect(visible).toBe(Math.floor(elapsed / 30) % 2 === 0);
      expect(serveArrowVisible(preparing, true)).toBe(true);
      if (phases.at(-1) !== visible) phases.push(visible);
    }
    expect(PONG_SERVE_DELAY_TICKS).toBe(120);
    expect(phases).toEqual([true, false, true, false]);
    expect(serveArrowVisible(playView, false)).toBe(false);
    expect(serveArrowVisible(playView, true)).toBe(false);
  });

  it("preserves the historical preparation phase for old active rooms", () => {
    for (
      let elapsed = 0;
      elapsed < PONG_LEGACY_SERVE_DELAY_TICKS;
      elapsed += 1
    ) {
      const preparing = {
        ...playView,
        serve: {
          ticksRemaining: PONG_LEGACY_SERVE_DELAY_TICKS - elapsed,
          directionX: 1 as const,
          directionY: -1 as const,
        },
      };
      expect(serveArrowVisible(preparing, false, "1.1.0")).toBe(
        Math.floor(elapsed / 30) % 2 === 0,
      );
    }
  });

  it("parses only the exact version's public view and countdown bounds", () => {
    const legacyView = Object.fromEntries(
      Object.entries(playView).filter(([key]) => key !== "serve"),
    );
    expect(parsePlayView(legacyView, "1.0.0")).toEqual(playView);
    expect(() => parsePlayView(legacyView, "1.1.0")).toThrow();
    expect(() => parsePlayView(playView, "1.0.0")).toThrow();
    expect(parsePlayView(playView, "1.1.0")).toEqual(playView);
    expect(parsePlayView(playView, "1.2.0")).toEqual(playView);
    expect(() => parsePlayView(legacyView, "1.2.0")).toThrow();
    expect(() => parsePlayView(playView, "1.3.0")).toThrow();
    for (const [version, duration] of [
      ["1.1.0", 210],
      ["1.2.0", 120],
    ] as const) {
      for (const ticksRemaining of [0, -1, 1.5, duration + 1]) {
        expect(() =>
          parsePlayView(
            {
              ...playView,
              serve: { ticksRemaining, directionX: 1, directionY: -1 },
            },
            version,
          ),
        ).toThrow();
      }
      expect(
        parsePlayView(
          {
            ...playView,
            serve: { ticksRemaining: duration, directionX: 1, directionY: -1 },
          },
          version,
        ).serve?.ticksRemaining,
      ).toBe(duration);
    }
    expect(() =>
      parsePlayView({ ...playView, rng: { seed: "private" } }, "1.2.0"),
    ).toThrow();
  });

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
    expect(resultSummary(won)).toEqual({
      tone: "win",
      headline: "你获胜",
      details: ["左侧 3 : 2 右侧", "率先达到目标分数"],
    });
  });
});
