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
import {
  renderSetupView,
  setupSummary,
  serveRuleLabel,
} from "../src/setup-presentation";
import { setupNotice } from "../src/setup-ui";

const fixture = playViewSchema.parse(
  JSON.parse(
    readFileSync(new URL("./fixtures/play.json", import.meta.url), "utf8"),
  ),
);

describe("badminton projected contracts", () => {
  it.each([
    [7, 11],
    [11, 15],
    [21, 30],
  ] as const)(
    "explains target %i, its cap %i and confirmed first server",
    (targetScore, cap) => {
      const setup = setupViewSchema.parse({
        config: { targetScore },
        starter: "OWNER",
        fixedStarterSlotId: null,
        participantSlotIds: ["owner"],
        canEdit: true,
      });
      expect(setupSummary(setup)).toBe(
        `${targetScore} 分制 · 领先 2 分 · ${cap} 分封顶 · 房主首发（左侧）`,
      );
      const markup = renderSetupView(setup, "1.2.0", false, false);
      expect(markup).toContain(`data-score-cap="${cap}"`);
      expect(markup).toContain(`至少得到 ${targetScore} 分并领先 2 分获胜`);
      expect(markup).toContain("达到封顶即获胜");
      expect(markup).toContain("等待另一位玩家加入");
      for (const expectedCap of [11, 15, 30])
        expect(markup).toContain(`${expectedCap} 分封顶`);
      expect(
        setupSummary({
          ...setup,
          starter: "FIXED",
          fixedStarterSlotId: "owner",
        }),
      ).toContain("沿用上一局");
      expect(setupSummary({ ...setup, starter: "RANDOM" })).toContain(
        "开局时随机",
      );
    },
  );

  it("describes automatic serving only for 1.0.0 and keeps 1.1.0 manual", () => {
    expect(serveRuleLabel("1.0.0")).toContain("准备倒计时结束后开球");
    for (const version of ["1.1.0", "1.2.0"]) {
      expect(serveRuleLabel(version)).toContain("发球方按 S");
      expect(serveRuleLabel(version)).toContain("不会超时失分");
    }
    expect(() => serveRuleLabel("1.3.0")).toThrow();
    const setup = setupViewSchema.parse({
      config: { targetScore: 7 },
      starter: "NON_OWNER",
      fixedStarterSlotId: null,
      participantSlotIds: ["owner", "guest"],
      canEdit: false,
    });
    const automatic = renderSetupView(setup, "1.0.0", false, false);
    expect(automatic).toContain('data-serve-mode="automatic"');
    expect(automatic).not.toContain("<kbd>S</kbd>");
    expect(automatic).toContain("由房主修改");
    expect(renderSetupView(setup, "1.1.0", false, false)).toContain(
      'data-serve-mode="manual"',
    );
  });

  it("explains stale, permission and connection failures without leaking errors", () => {
    expect(setupNotice("accepted")).toBeNull();
    expect(setupNotice("stale")).toContain("设置已被更新");
    expect(setupNotice("rejected", "NOT_OWNER")).toContain("只有房主");
    expect(setupNotice("rejected", "HOST_REJECTED")).toContain("连接");
    expect(setupNotice("rejected", "SETUP_UNCHANGED")).toContain("没有变化");
    expect(setupNotice("rejected", "internal-error")).not.toContain(
      "internal-error",
    );
  });

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
      serve: false,
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
      serve: false,
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
    expect(phaseLabel(fixture)).toBe("你的发球");
    expect(phaseLabel({ ...fixture, yourSide: "RIGHT" })).toBe("等待对手发球");
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
