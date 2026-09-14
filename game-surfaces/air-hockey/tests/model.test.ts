import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hostSurfaceMessageSchema } from "@online-game-hub/game-surface-bridge";
import {
  parsePlayView,
  playIntentSchema,
  playViewSchema,
  setupIntentSchema,
  setupViewSchema,
  type Impact,
  type PlayView,
} from "../src/contracts";
import {
  CANVAS,
  EFFECT_LIFETIME,
  ImpactFeed,
  PointerControls,
  RAIL_LENGTH,
  phaseLabel,
  pointerTarget,
  railOrigin,
  railPoint,
  resultSummary,
  setupNotice,
  shouldInterpolate,
  toScreen,
} from "../src/model";

const fixture: PlayView = parsePlayView(
  JSON.parse(
    readFileSync(new URL("./fixtures/play.json", import.meta.url), "utf8"),
  ),
  "1.0.0",
);
const impact = (id: number, tick: number): Impact => ({
  id,
  tick,
  kind: "WALL",
  x: 0,
  y: 600000,
  strength: 800,
  side: null,
  edge: "LEFT",
});

describe("public projections and intents", () => {
  it.each(["1.0.0", "1.1.0"])(
    "accepts the exact public view for %s",
    (version) => {
      expect(parsePlayView(fixture, version)).toEqual(fixture);
    },
  );
  it("accepts public fixtures through Bridge without private simulation fields", () => {
    const setup = JSON.parse(
      readFileSync(new URL("./fixtures/setup.json", import.meta.url), "utf8"),
    );
    expect(setupViewSchema.parse(setup).config.targetScore).toBe(7);
    for (const payload of [fixture, setup]) {
      expect(
        hostSurfaceMessageSchema.safeParse({
          type: "host.state",
          sequence: 1,
          roundNumber: 1,
          connectionState: "connected",
          readOnly: false,
          payload,
        }).success,
      ).toBe(true);
    }
    for (const key of ["rng", "seed", "actorSlotId", "state", "inputSequence"])
      expect(
        playViewSchema.safeParse({ ...fixture, [key]: "private" }).success,
      ).toBe(false);
    expect(
      playViewSchema.safeParse({
        ...fixture,
        puck: { ...fixture.puck, velocityX: 1000 },
      }).success,
    ).toBe(false);
    expect(() => parsePlayView(fixture, "2.0.0")).toThrow();
    expect(
      playViewSchema.safeParse({ ...fixture, phase: "FINISHED" }).success,
    ).toBe(false);
    expect(
      playViewSchema.safeParse({ ...fixture, events: [impact(1, 0)] }).success,
    ).toBe(false);
    expect(
      playViewSchema.safeParse({
        ...fixture,
        tick: 4,
        events: [impact(2, 1), impact(1, 2)],
      }).success,
    ).toBe(false);
  });
  it.each([5, 7, 11])("allows the exact %i point setting", (targetScore) => {
    expect(
      setupIntentSchema.parse({ type: "SET_TARGET_SCORE", targetScore })
        .targetScore,
    ).toBe(targetScore);
  });
  it("rejects forged, fractional and out of range inputs", () => {
    for (const input of [
      { type: "CONTROL", target: { x: -1, y: 5000 } },
      { type: "CONTROL", target: { x: 5000, y: 10001 } },
      { type: "CONTROL", target: { x: 0.5, y: 5000 } },
      { type: "CONTROL", target: { x: 100, y: 5000, velocityX: 1 } },
      { type: "CONTROL", target: null, actorSlotId: "guest" },
      { type: "RESIGN", score: 7 },
    ])
      expect(playIntentSchema.safeParse(input).success).toBe(false);
    expect(playIntentSchema.parse({ type: "CONTROL", target: null })).toEqual({
      type: "CONTROL",
      target: null,
    });
    expect(
      setupIntentSchema.safeParse({ type: "SET_TARGET_SCORE", targetScore: 6 })
        .success,
    ).toBe(false);
  });
});

describe("pointer controls and display coordinates", () => {
  it.each([0, 1] as const)(
    "round trips a scaled P%i view without flipping x",
    (side) => {
      const point = { x: 123000, y: side === 0 ? 700000 : 320000 };
      const screen = toScreen(point, side);
      expect(screen).toEqual({ x: 135, y: 712 });
      for (const scale of [0.2, 0.7, 1.5]) {
        const rect = {
          left: 27,
          top: 83,
          width: CANVAS.width * scale,
          height: CANVAS.height * scale,
        };
        expect(
          pointerTarget(
            { x: rect.left + screen.x * scale, y: rect.top + screen.y * scale },
            rect,
          ),
        ).toEqual({ x: 2050, y: 6863 });
      }
    },
  );
  it("ignores touch starts in letterboxing and clamps active pointers to the court", () => {
    const rect = {
      left: 0,
      top: 0,
      width: CANVAS.width,
      height: CANVAS.height,
    };
    expect(pointerTarget({ x: 0, y: 0 }, rect)).toBeNull();
    expect(pointerTarget({ x: -100, y: 2000 }, rect, true)).toEqual({
      x: 0,
      y: 10000,
    });
    expect(pointerTarget({ x: 100, y: 100 }, { ...rect, width: 0 })).toBeNull();
  });
  it("coalesces mouse targets, caps movement at 60Hz and renews idle targets", () => {
    const controls = new PointerControls();
    controls.mouse({ x: 1000, y: 7000 });
    controls.mouse({ x: 2000, y: 7000 });
    expect(controls.take(0)).toEqual({
      type: "CONTROL",
      target: { x: 2000, y: 7000 },
    });
    controls.mouse({ x: 3000, y: 7000 });
    expect(controls.take(10)).toBeNull();
    expect(controls.take(17)).toEqual({
      type: "CONTROL",
      target: { x: 3000, y: 7000 },
    });
    expect(controls.take(166)).toBeNull();
    expect(controls.take(167)).toEqual({
      type: "CONTROL",
      target: { x: 3000, y: 7000 },
    });
    controls.mouse(null);
    expect(controls.take(168)).toEqual({ type: "CONTROL", target: null });
    expect(controls.take(1000)).toBeNull();
  });
  it("captures only a first own-half touch and clamps crossing the center", () => {
    const controls = new PointerControls();
    expect(controls.startTouch(1, { x: 5000, y: 3000 })).toBe(false);
    expect(controls.startTouch(1, { x: 5000, y: 7500 })).toBe(true);
    expect(controls.startTouch(2, { x: 9000, y: 7000 })).toBe(false);
    controls.moveTouch(2, { x: 9000, y: 8000 });
    controls.mouse({ x: 9000, y: 9000 });
    expect(controls.take(0)).toEqual({
      type: "CONTROL",
      target: { x: 5000, y: 7500 },
    });
    controls.moveTouch(1, { x: 3000, y: 2000 });
    expect(controls.take(20)).toEqual({
      type: "CONTROL",
      target: { x: 3000, y: 5000 },
    });
    controls.endTouch(2);
    expect(controls.touchId).toBe(1);
    controls.endTouch(1);
    expect(controls.take(21)).toEqual({ type: "CONTROL", target: null });
    expect(controls.active).toBe(false);
  });
  it("invalidates old touches and targets after reset or reconnect", () => {
    const controls = new PointerControls();
    controls.startTouch(4, { x: 5000, y: 8000 });
    controls.take(0);
    controls.discard();
    controls.moveTouch(4, { x: 9000, y: 9000 });
    expect(controls.take(1000)).toBeNull();
    expect(controls.startTouch(5, { x: 7000, y: 8000 })).toBe(true);
    expect(controls.take(1001)).toEqual({
      type: "CONTROL",
      target: { x: 7000, y: 8000 },
    });
  });
  it("interpolates consecutive authoritative snapshots and snaps across discontinuities", () => {
    const next = { ...fixture, tick: 1 };
    expect(shouldInterpolate(fixture, next, false)).toBe(true);
    for (const current of [
      { ...next, rally: 2 },
      { ...next, phase: "RALLY" as const },
      { ...next, yourSide: 1 as const },
      { ...next, tick: 13 },
      fixture,
    ])
      expect(shouldInterpolate(fixture, current, false)).toBe(false);
    expect(shouldInterpolate(fixture, next, true)).toBe(false);
  });
});

describe("authoritative feedback", () => {
  it("does not replay initial or reconnected events, deduplicates snapshots and expires effects", () => {
    const feed = new ImpactFeed();
    const first = { ...fixture, tick: 2, events: [impact(1, 1)] };
    expect(feed.observe(first, 0)).toEqual([]);
    const second = {
      ...first,
      tick: 3,
      events: [...first.events, impact(2, 2)],
    };
    expect(feed.observe(second, 17)).toEqual([impact(2, 2)]);
    expect(feed.observe(second, 18)).toEqual([]);
    expect(feed.visuals(30)).toHaveLength(1);
    expect(feed.visuals(17 + EFFECT_LIFETIME)).toHaveLength(0);
    expect(
      feed.observe({ ...second, tick: 4, events: [impact(3, 3)] }, 40, true),
    ).toEqual([]);
    expect(
      feed.observe({ ...second, tick: 30, events: [impact(4, 4)] }, 50),
    ).toEqual([]);
    feed.clear();
    expect(
      feed.observe({ ...second, tick: 31, events: [impact(5, 30)] }, 60),
    ).toEqual([]);
  });
  it("follows both rounded corners and stops at goal openings in both views", () => {
    for (const right of [false, true]) {
      expect(railPoint(-100, right)).toEqual({
        x: right ? 384000 : 216000,
        y: 0,
      });
      expect(railPoint(RAIL_LENGTH + 100, right).x).toBeCloseTo(
        right ? 384000 : 216000,
      );
      expect(railPoint(RAIL_LENGTH + 100, right).y).toBe(1020000);
      let previous = railPoint(0, right);
      for (let d = 1; d < RAIL_LENGTH; d++) {
        const point = railPoint(d, right);
        expect(
          Math.hypot(point.x - previous.x, point.y - previous.y),
        ).toBeLessThanOrEqual(1000.001);
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(600000);
        const reflected = toScreen(point, 1);
        expect(reflected.x).toBe(toScreen(point, 0).x);
        expect(reflected.y + toScreen(point, 0).y).toBeCloseTo(CANVAS.height);
        previous = point;
      }
      const event = {
        ...impact(1, 1),
        x: right ? 600000 : 0,
        edge: right ? ("RIGHT" as const) : ("LEFT" as const),
      };
      const origin = railOrigin(event);
      expect(origin.right).toBe(right);
      expect(railPoint(origin.distance, right).y).toBeCloseTo(event.y);
    }
  });
  it("labels serving rights and preserves actual resignation scores", () => {
    expect(phaseLabel(fixture)).toContain("由你开球");
    expect(phaseLabel({ ...fixture, yourSide: 1 })).toBe("等待对方开球");
    expect(resultSummary(fixture)).toBeNull();
    const completed: PlayView = {
      ...fixture,
      phase: "FINISHED",
      scores: [1, 4],
      outcome: {
        type: "WIN",
        reason: "RESIGNATION",
        winnerSlotId: "owner",
        resignedSlotId: "guest",
        scores: [1, 4],
      },
    };
    expect(resultSummary(completed)).toEqual({
      tone: "win",
      headline: "你获胜",
      details: ["蓝方 1 : 4 橙方", "本局因投降结束"],
    });
    expect(resultSummary({ ...completed, yourSide: 1 })?.tone).toBe("loss");
    expect(setupNotice("stale")).toContain("设置已被更新");
    expect(setupNotice("rejected", "NOT_OWNER")).toContain("只有房主");
    expect(setupNotice("rejected", "private-stack")).not.toContain(
      "private-stack",
    );
  });
});
