import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { surfaceHostMessageV2Schema } from "@online-game-hub/game-surface-bridge";
import {
  playViewSchema,
  playIntentSchema,
  setupViewSchema,
  setupIntentSchema,
} from "../src/contracts";
import {
  ControlState,
  KEY_CONTROLS,
  interpolationAlpha,
  phaseLabel,
  resultSummary,
} from "../src/model";

const fixture = playViewSchema.parse(
  JSON.parse(
    readFileSync(new URL("./fixtures/play.json", import.meta.url), "utf8"),
  ),
);

describe("badminton projected contracts", () => {
  it("accepts the public initial view and excludes simulation state and identity claims", () => {
    expect(fixture.yourSide).toBe("LEFT");
    for (const key of ["rng", "seed", "actorSlotId", "inputSequence", "state"])
      expect(
        playViewSchema.safeParse({ ...fixture, [key]: "hidden" }).success,
      ).toBe(false);
    expect(
      playViewSchema.safeParse({
        ...fixture,
        shuttle: { ...fixture.shuttle, velocityX: 6000 },
      }).success,
    ).toBe(false);
    expect(
      playViewSchema.safeParse({
        ...fixture,
        athletes: [
          { ...fixture.athletes[0], controls: {} },
          fixture.athletes[1],
        ],
      }).success,
    ).toBe(false);
    expect(playViewSchema.safeParse({ ...fixture, scoreCap: 30 }).success).toBe(
      false,
    );
    expect(
      playViewSchema.safeParse({ ...fixture, phase: "FINISHED" }).success,
    ).toBe(false);
  });

  it("validates setup permissions, unique slots, fixed order and minimal setup intents", () => {
    const setup = {
      config: { targetScore: 7 },
      starter: "OWNER",
      fixedStarterSlotId: null,
      participantSlotIds: ["a", "b"],
      canEdit: true,
    };
    expect(setupViewSchema.parse(setup)).toEqual(setup);
    expect(
      setupViewSchema.safeParse({ ...setup, starter: "FIXED" }).success,
    ).toBe(false);
    expect(
      setupViewSchema.safeParse({ ...setup, participantSlotIds: ["a", "a"] })
        .success,
    ).toBe(false);
    expect(
      setupIntentSchema.parse({ type: "SET_TARGET_SCORE", targetScore: 11 }),
    ).toEqual({ type: "SET_TARGET_SCORE", targetScore: 11 });
    expect(
      setupIntentSchema.safeParse({
        type: "SELECT_STARTER",
        starter: "FIXED",
        slotId: "a",
      }).success,
    ).toBe(false);
  });

  it("generates Bridge-safe combined control and resignation intents without transport metadata", () => {
    const state = new ControlState();
    state.press("key-a", "left");
    state.press("touch-1", "jump");
    state.press("touch-2", "smash");
    const intent = state.intent();
    expect(playIntentSchema.parse(intent)).toEqual({
      type: "CONTROL",
      move: -1,
      jump: true,
      shot: "SMASH",
    });
    expect(
      surfaceHostMessageV2Schema.safeParse({
        type: "surface.intent",
        clientIntentId: "badminton-play-1",
        intent,
      }).success,
    ).toBe(true);
    expect(
      playIntentSchema.safeParse({ ...intent, actor: "someone" }).success,
    ).toBe(false);
    expect(playIntentSchema.parse({ type: "RESIGN" })).toEqual({
      type: "RESIGN",
    });
  });
});

describe("multi-source controls and presentation", () => {
  it("keeps another finger or keyboard alias held when a source releases", () => {
    const state = new ControlState();
    state.press("key-a", "left");
    state.press("touch-left", "left");
    state.press("touch-jump", "jump");
    state.release("touch-left");
    expect(state.intent()).toMatchObject({ move: -1, jump: true });
    state.press("key-d", "right");
    expect(state.intent().move).toBe(0);
    state.release("key-a");
    expect(state.intent().move).toBe(1);
    state.reset();
    expect(state.active).toBe(false);
    expect(state.intent()).toEqual({
      type: "CONTROL",
      move: 0,
      jump: false,
      shot: "NONE",
    });
  });

  it("maps accessible keys and handles repeated keydown without stacking presses", () => {
    const state = new ControlState();
    expect(KEY_CONTROLS.Space).toBe("jump");
    expect(KEY_CONTROLS.ArrowRight).toBe("right");
    state.press("key-j", "clear");
    state.press("key-j", "clear");
    state.press("key-k", "smash");
    expect(state.intent().shot).toBe("SMASH");
    state.release("key-k");
    expect(state.intent().shot).toBe("CLEAR");
    state.release("key-j");
    expect(state.intent().shot).toBe("NONE");
  });

  it("interpolates only contiguous rally snapshots and snaps on phase, round, gap or reduced-motion changes", () => {
    const previous = { ...fixture, phase: "RALLY" as const, tick: 1 };
    const current = { ...previous, tick: 4 };
    expect(interpolationAlpha(previous, current, 25, false)).toBeCloseTo(0.5);
    expect(interpolationAlpha(previous, current, 100, false)).toBe(1);
    expect(interpolationAlpha(previous, current, 1, true)).toBe(1);
    expect(
      interpolationAlpha(previous, { ...current, rally: 2 }, 1, false),
    ).toBe(1);
    expect(
      interpolationAlpha(previous, { ...current, phase: "POINT" }, 1, false),
    ).toBe(1);
    expect(
      interpolationAlpha(previous, { ...current, tick: 30 }, 1, false),
    ).toBe(1);
    expect(interpolationAlpha(null, current, 0, false)).toBe(1);
  });

  it("describes serve and point outcomes solely from the projected view", () => {
    expect(phaseLabel(fixture)).toBe("你发球 · 2");
    expect(phaseLabel({ ...fixture, yourSide: "RIGHT" })).toBe("对手发球 · 2");
    expect(
      phaseLabel({
        ...fixture,
        phase: "POINT",
        lastPoint: { winner: 0, reason: "NET", x: 500000, y: 340000 },
      }),
    ).toBe("你得分 · 触网");
  });

  it("sends a concise viewer-specific result summary and no active summary", () => {
    expect(resultSummary(fixture)).toBeNull();
    const finished = playViewSchema.parse({
      ...fixture,
      phase: "FINISHED",
      phaseTicks: 0,
      scores: [7, 3],
      bestRally: 9,
      outcome: {
        type: "WIN",
        reason: "SCORE",
        winnerSlotId: fixture.players[0].slotId,
        scores: [7, 3],
      },
    });
    const summary = resultSummary(finished);
    expect(summary).toEqual({
      tone: "win",
      headline: "好球，你赢了！",
      details: ["蓝方 7 : 3 橙方", "本局达到获胜比分", "最长回合 9 拍"],
    });
    expect(resultSummary({ ...finished, yourSide: "RIGHT" })?.tone).toBe(
      "loss",
    );
    expect(
      surfaceHostMessageV2Schema.safeParse({
        type: "surface.result-summary",
        stateSequence: 10,
        ...summary,
      }).success,
    ).toBe(true);
  });
});
