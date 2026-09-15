import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { actionKey, movement, EffectFeed, summary } from "../src/model";
import {
  playIntentSchema,
  setupIntentSchema,
  playViewSchema,
  parsePlayView,
  type Effect,
  type PlayView,
} from "../src/contracts";
it("accepts a public server projection and the actual three-frame attack sheet", () => {
  const view = JSON.parse(
    readFileSync(new URL("./fixtures/play.json", import.meta.url), "utf8"),
  );
  expect(parsePlayView(view, "1.0.0").players).toHaveLength(4);
  const current = JSON.parse(
    readFileSync(new URL("./fixtures/play-1.1.json", import.meta.url), "utf8"),
  );
  expect(parsePlayView(current, "1.1.0").hitstopTicks).toBe(0);
  expect(() => parsePlayView(view, "1.1.0")).toThrow();
  expect(() => parsePlayView(current, "1.0.0")).toThrow();
  const png = readFileSync(
    new URL("../assets/ninja/p_hit1.png", import.meta.url),
  );
  expect(png.readUInt32BE(16)).toBe(3 * 40);
  expect(png.readUInt32BE(20)).toBe(24);
});
it("keeps multi-touch directions independent and cancels opposite inputs", () => {
  const touch = new Map<number, -1 | 1>([
    [1, -1],
    [2, 1],
  ]);
  expect(movement(new Set(), touch)).toBe(0);
  touch.delete(2);
  expect(movement(new Set(), touch)).toBe(-1);
  expect(movement(new Set(["KeyD"]), touch)).toBe(0);
  expect(movement(new Set(["ArrowRight"]), new Map())).toBe(1);
});
it("maps actions and rejects forged intents", () => {
  expect(actionKey("Space")).toEqual({ type: "JUMP" });
  expect(actionKey("KeyJ")).toEqual({ type: "ATTACK" });
  expect(actionKey("ShiftLeft")).toEqual({ type: "SLIDE" });
  expect(actionKey("KeyX")).toBeNull();
  expect(
    playIntentSchema.safeParse({ type: "ATTACK", actor: "p1" }).success,
  ).toBe(false);
  expect(
    setupIntentSchema.safeParse({ type: "SET_TARGET_SCORE", targetScore: 4 })
      .success,
  ).toBe(false);
});
it("suppresses old effects on reconnect and summaries without outcome", () => {
  const feed = new EffectFeed();
  const view = {
    tick: 0,
    effects: [effect(1, "CLASH")],
    outcome: null,
  } as PlayView;
  expect(feed.observe(view, true)).toEqual([]);
  expect(feed.observe(view, false)).toEqual([]);
  expect(summary(view)).toBeNull();
  expect(
    feed.observe({ ...view, effects: [effect(2, "DEATH")] }, false),
  ).toHaveLength(1);
  expect(playViewSchema.safeParse({ state: view }).success).toBe(false);
});
it("keeps final kills across phase changes but never replays consumed or expired effects", () => {
  const feed = new EffectFeed(),
    base = parsePlayView(
      JSON.parse(
        readFileSync(new URL("./fixtures/play.json", import.meta.url), "utf8"),
      ),
      "1.0.0",
    );
  feed.observe(base, true);
  const death = { ...effect(10, "DEATH"), startedAt: 180, until: 222 };
  const countdown = {
    ...base,
    tick: 181,
    round: 2,
    phase: "COUNTDOWN" as const,
    effects: [death],
  };
  expect(feed.observe(countdown, false)).toEqual([death]);
  expect(feed.observe(countdown, false)).toEqual([]);
  feed.observe({ ...countdown, effects: [] }, false);
  expect(feed.observe(countdown, false)).toEqual([]);
  expect(
    feed.observe(
      { ...countdown, phase: "FINISHED", effects: [{ ...death, id: 11 }] },
      false,
    ),
  ).toHaveLength(1);
  expect(
    feed.observe(
      { ...countdown, tick: 240, effects: [{ ...death, id: 12 }] },
      false,
    ),
  ).toEqual([]);
});
function effect(id: number, kind: Effect["kind"]): Effect {
  return {
    id,
    kind,
    x: 32000,
    y: 22000,
    startedAt: 0,
    until: 42,
    sourceSlotId: "p0",
    targetSlotId: "p1",
    facing: 1,
  };
}
