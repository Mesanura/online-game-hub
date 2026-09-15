import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { actionKey, movement, EffectFeed, summary } from "../src/model";
import {
  playIntentSchema,
  setupIntentSchema,
  playViewSchema,
  type PlayView,
} from "../src/contracts";
it("accepts a public server projection and the actual three-frame attack sheet", () => {
  const view = JSON.parse(
    readFileSync(new URL("./fixtures/play.json", import.meta.url), "utf8"),
  );
  expect(playViewSchema.parse(view).players).toHaveLength(4);
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
    effects: [{ id: 1, kind: "CLASH", x: 0, y: 0, until: 20 }],
    outcome: null,
  } as PlayView;
  expect(feed.observe(view, true)).toEqual([]);
  expect(feed.observe(view, false)).toEqual([]);
  expect(summary(view)).toBeNull();
  expect(
    feed.observe(
      { ...view, effects: [{ id: 2, kind: "DEATH", x: 0, y: 0, until: 25 }] },
      false,
    ),
  ).toHaveLength(1);
  expect(playViewSchema.safeParse({ state: view }).success).toBe(false);
});
