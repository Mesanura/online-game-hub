import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parsePlayView,
  playIntentSchema,
  setupViewSchema,
} from "../src/contracts";
import {
  Controls,
  EffectFeed,
  isControlKey,
  joystickPosition,
  phaseLabel,
  resultSummary,
  setupNotice,
  shouldInterpolate,
} from "../src/model";
import {
  bombSprite,
  brickSprite,
  flameSprite,
  floorSprite,
  pickupSprite,
  playerSprite,
  wallSprite,
} from "../src/pixels";
const fixture = () =>
  parsePlayView(
    JSON.parse(
      readFileSync(new URL("./fixtures/play.json", import.meta.url), "utf8"),
    ),
    "1.0.0",
  );

describe("public contracts", () => {
  it("parses the actual public Core/Setup projections without importing their packages", () => {
    const view = fixture();
    expect(view.config.playerCount).toBe(4);
    expect(view.arena.tiles).toHaveLength(view.arena.cols * view.arena.rows);
    expect(parsePlayView(JSON.parse(JSON.stringify(view)), "1.0.0")).toEqual(
      view,
    );
    const setup = setupViewSchema.parse(
      JSON.parse(
        readFileSync(new URL("./fixtures/setup.json", import.meta.url), "utf8"),
      ),
    );
    expect(setup).toMatchObject({ canEdit: true, playerCounts: [2, 3, 4] });
  });
  it("rejects unknown versions, sensitive fields and inconsistent geometry or ownership", () => {
    const view = fixture();
    expect(() => parsePlayView(view, "2.0.0")).toThrow();
    for (const key of ["seed", "state", "pendingLoot", "lease"])
      expect(() => parsePlayView({ ...view, [key]: {} }, "1.0.0")).toThrow();
    expect(() =>
      parsePlayView({ ...view, arena: { ...view.arena, tiles: [] } }, "1.0.0"),
    ).toThrow();
    expect(() =>
      parsePlayView({ ...view, selfSlotId: "outsider" }, "1.0.0"),
    ).toThrow();
    expect(() =>
      parsePlayView(
        {
          ...view,
          bombs: [{ id: 1, cell: 999, ownerSlotId: "p0", fuseTicks: 10 }],
        },
        "1.0.0",
      ),
    ).toThrow();
    expect(() =>
      parsePlayView(
        { ...view, players: [view.players[0], ...view.players.slice(0, 3)] },
        "1.0.0",
      ),
    ).toThrow();
    expect(() =>
      parsePlayView({ ...view, phase: "COMPLETE" }, "1.0.0"),
    ).toThrow();
    expect(
      playIntentSchema.safeParse({ type: "PLACE_BOMB", actor: "p0" }).success,
    ).toBe(false);
    expect(
      playIntentSchema.safeParse({ type: "MOVE", direction: "diagonal" })
        .success,
    ).toBe(false);
  });
});
describe("keyboard and four-way stick", () => {
  it("uses the most recent held key and restores earlier keys and aliases on release", () => {
    const controls = new Controls();
    controls.keyDown("KeyW");
    controls.keyDown("KeyD");
    expect(controls.direction).toBe("right");
    controls.keyUp("KeyD");
    expect(controls.direction).toBe("up");
    controls.keyDown("ArrowUp");
    controls.keyUp("KeyW");
    expect(controls.direction).toBe("up");
    controls.keyDown("KeyS");
    expect(controls.direction).toBe("down");
    controls.keyUp("KeyS");
    controls.keyUp("ArrowUp");
    expect(controls.direction).toBe("none");
    expect(isControlKey("KeyQ")).toBe(false);
  });
  it("fires once per direct space press and ignores OS repeat, including after a reset", () => {
    const controls = new Controls();
    expect(controls.keyDown("Space")).toBe(true);
    expect(controls.keyDown("Space")).toBe(false);
    expect(controls.keyDown("Space", true)).toBe(false);
    controls.keyUp("Space");
    expect(controls.keyDown("Space")).toBe(true);
    controls.clear();
    expect(controls.keyDown("Space", true)).toBe(false);
    expect(controls.bombHeld).toBe(false);
  });
  it("has a 20% deadzone, four dominant axes, stable ties and a bounded thumb position", () => {
    expect(joystickPosition(8, 0, 40).direction).toBe("none");
    expect(joystickPosition(9, 0, 40).direction).toBe("right");
    expect(joystickPosition(30, -40, 40).direction).toBe("up");
    expect(joystickPosition(-40, 30, 40).direction).toBe("left");
    expect(joystickPosition(30, 40, 40).direction).toBe("down");
    expect(joystickPosition(30, -30, 40, "up").direction).toBe("up");
    expect(joystickPosition(30, 30, 40).direction).toBe("right");
    const far = joystickPosition(200, 200, 40);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(40);
  });
  it("keeps keyboard, stick and bomb pointers independent during real multi-input use", () => {
    const controls = new Controls();
    controls.keyDown("KeyW");
    expect(controls.startStick(1)).toBe(true);
    expect(controls.startStick(2)).toBe(false);
    controls.moveStick(1, 40, 0, 40);
    expect(controls.direction).toBe("right");
    controls.moveStick(2, 0, 40, 40);
    controls.endStick(2);
    expect(controls.direction).toBe("right");
    expect(controls.pressBomb(2)).toBe(true);
    expect(controls.pressBomb(2)).toBe(false);
    controls.releaseBomb(2);
    expect(controls.direction).toBe("right");
    controls.endStick(1);
    expect(controls.direction).toBe("up");
    controls.clear();
    expect(controls.direction).toBe("none");
    expect(controls.stickId).toBeNull();
    controls.moveStick(1, 40, 0, 40);
    expect(controls.direction).toBe("none");
  });
  it("renews unchanged movement every 150ms and sends neutral immediately on release", () => {
    const controls = new Controls();
    expect(controls.take(0)).toBeNull();
    controls.keyDown("KeyA");
    expect(controls.take(0)).toEqual({ type: "MOVE", direction: "left" });
    expect(controls.take(149)).toBeNull();
    expect(controls.take(150)).toEqual({ type: "MOVE", direction: "left" });
    controls.keyUp("KeyA");
    expect(controls.take(151)).toEqual({ type: "MOVE", direction: "none" });
    expect(controls.take(999)).toBeNull();
    controls.keyDown("KeyD");
    controls.take(1000);
    expect(controls.clear()).toBe(true);
    expect(controls.take(1200)).toBeNull();
  });
});
describe("presentation", () => {
  it("deduplicates effects and never replays old audio on load, reconnect or resume", () => {
    const feed = new EffectFeed();
    const event = (id: number) => ({
      id,
      kind: "explode" as const,
      x: 1200,
      y: 1200,
    });
    expect(feed.observe([event(1)])).toEqual([]);
    expect(feed.observe([event(1), event(2)])).toEqual([event(2)]);
    expect(feed.observe([event(1), event(2)])).toEqual([]);
    expect(feed.observe([event(3), event(4)], true)).toEqual([]);
    expect(feed.observe([event(4), event(5)])).toEqual([event(5)]);
    feed.clear();
    expect(feed.observe([event(6)])).toEqual([]);
  });
  it("interpolates only consecutive active frames in the same arena and bout", () => {
    const view = fixture();
    expect(shouldInterpolate(view, view, false)).toBe(true);
    expect(shouldInterpolate(view, { ...view, bout: 2 }, false)).toBe(false);
    expect(shouldInterpolate(view, { ...view, phase: "RESULT" }, false)).toBe(
      false,
    );
    expect(shouldInterpolate(view, view, true)).toBe(false);
    expect(shouldInterpolate(null, view, false)).toBe(false);
  });
  it("renders personalized win, loss, draw and eliminated-player explanations", () => {
    const view = fixture();
    expect(resultSummary(view)).toBeNull();
    const scores = view.players.map((player) => ({
      slotId: player.slotId,
      score: player.index === 0 ? 3 : 0,
    }));
    const won = {
      ...view,
      phase: "COMPLETE" as const,
      outcome: {
        type: "WIN" as const,
        winnerSlotId: "p0",
        reason: "SCORE" as const,
        scores,
      },
    };
    expect(resultSummary(won)).toMatchObject({
      tone: "win",
      headline: "你赢下了整场！",
    });
    expect(resultSummary({ ...won, selfSlotId: "p1" })?.tone).toBe("loss");
    expect(
      resultSummary({
        ...won,
        outcome: {
          type: "DRAW",
          winnerSlotId: null,
          reason: "RESIGNATION",
          scores: scores.map((score) => ({ ...score, score: 0 })),
        },
      })?.tone,
    ).toBe("draw");
    expect(
      phaseLabel({
        ...view,
        players: view.players.map((player) => ({ ...player, alive: false })),
      }),
    ).toContain("下一小局自动复活");
    expect(setupNotice("stale")).toContain("最新人数");
    expect(setupNotice("rejected", "NOT_OWNER")).toContain("房主");
  });
  it("owns a complete set of original pixel glyphs with valid palettes", () => {
    const sprites = [
      floorSprite(),
      wallSprite,
      brickSprite,
      bombSprite(),
      flameSprite(0),
      ...(["capacity", "range", "speed"] as const).map(pickupSprite),
    ];
    for (let index = 0; index < 8; index += 1)
      for (const facing of ["up", "right", "down", "left"])
        for (const frame of [0, 1])
          sprites.push(playerSprite(index, facing, frame));
    for (const sprite of sprites)
      for (const row of sprite.rows) {
        expect(row).toHaveLength(16);
        for (const pixel of row)
          if (pixel !== ".")
            expect(sprite.palette[pixel]).toMatch(/^#[0-9a-f]{6}$/i);
      }
  });
});
