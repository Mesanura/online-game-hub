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
  protectionVisual,
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
const livesFixture = (version: "1.1.0" | "1.2.0" = "1.1.0") =>
  parsePlayView(
    JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/play-" + version.slice(0, 3) + ".json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    version,
  );

describe("public contracts", () => {
  it("accepts exact new starting stats and excess active bombs after a capacity drop", () => {
    const view = livesFixture("1.2.0");
    expect(
      view.players.every(
        (player) => player.capacity === 2 && player.range === 1,
      ),
    ).toBe(true);
    expect(() => parsePlayView(view, "1.1.0")).toThrow();
    expect(() => parsePlayView(livesFixture(), "1.2.0")).toThrow();
    const actor = view.players[0];
    if (!actor) throw new Error("Missing fixture player");
    actor.capacity = 3;
    actor.activeBombs = 4;
    view.bombs = [14, 16, 18, 20].map((cell, index) => ({
      id: index + 1,
      cell,
      ownerSlotId: actor.slotId,
      fuseTicks: 100,
    }));
    expect(parsePlayView(view, "1.2.0").players[0]).toMatchObject({
      capacity: 3,
      activeBombs: 4,
    });
    const previous = livesFixture();
    Object.assign(previous.players[0] ?? {}, { capacity: 3, activeBombs: 4 });
    expect(() => parsePlayView(previous, "1.1.0")).toThrow();
    for (const [key, value] of [
      ["capacity", 1],
      ["range", 0],
    ] as const)
      expect(() =>
        parsePlayView(
          {
            ...view,
            players: view.players.map((player) => ({
              ...player,
              [key]: value,
            })),
          },
          "1.2.0",
        ),
      ).toThrow();
  });
  it("parses the new life and directional flame projection while keeping exact legacy schemas", () => {
    const view = livesFixture();
    expect(view.startingLives).toBe(3);
    expect(view.players[0]).toMatchObject({
      lives: 2,
      invulnerableTicks: 119,
      speed: 4,
    });
    expect(new Set(view.flames.map((flame) => flame.shape))).toEqual(
      new Set(["center", "horizontal", "vertical"]),
    );
    expect(() => parsePlayView(view, "1.0.0")).toThrow();
    expect(() => parsePlayView(fixture(), "1.1.0")).toThrow();
    for (const invalid of [
      {
        ...view,
        players: view.players.map((player) => ({ ...player, lives: 4 })),
      },
      {
        ...view,
        players: view.players.map((player) => ({
          ...player,
          invulnerableUntil: 452,
        })),
      },
      {
        ...view,
        players: view.players.map((player) => ({ ...player, lives: 0 })),
      },
      {
        ...view,
        flames: view.flames.map((flame) => ({ ...flame, shape: "unknown" })),
      },
      { ...view, phase: "RESULT" },
    ])
      expect(() => parsePlayView(invalid, "1.1.0")).toThrow();
  });
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
  it("explains three lives, immunity, final elimination, draws and surviving lives in the summary", () => {
    const view = livesFixture();
    expect(phaseLabel(view)).toContain("无敌");
    const players = view.players.map((player) => ({
      ...player,
      alive: player.index === 0,
      lives: player.index === 0 ? 2 : 0,
      invulnerableTicks: 0,
    }));
    const won = parsePlayView(
      {
        ...view,
        players,
        phase: "COMPLETE",
        outcome: {
          type: "WIN",
          reason: "SURVIVOR",
          winnerSlotId: "p0",
          standings: players.map(({ slotId, lives, resigned }) => ({
            slotId,
            lives,
            resigned,
          })),
        },
      },
      "1.1.0",
    );
    expect(resultSummary(won)).toMatchObject({
      tone: "win",
      details: expect.arrayContaining(["P1 · 2 条命", "成为最后的幸存者"]),
    });
    expect(resultSummary({ ...won, selfSlotId: "p1" })?.tone).toBe("loss");
    expect(phaseLabel({ ...view, players, selfSlotId: "p1" })).toContain(
      "生命耗尽",
    );
    expect(phaseLabel({ ...view, phase: "PREPARE" })).toBe(
      "一局三命 · 准备开炸",
    );
  });
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
      for (const frame of [0, 1]) sprites.push(playerSprite(index, frame));
    for (const sprite of sprites)
      for (const row of sprite.rows) {
        expect(row).toHaveLength(16);
        for (const pixel of row)
          if (pixel !== ".")
            expect(sprite.palette[pixel]).toMatch(/^#[0-9a-f]{6}$/i);
      }
  });
  it("centers symmetric character silhouettes on the collision footprint in every frame", () => {
    for (let index = 0; index < 8; index += 1) {
      for (const frame of [0, 1]) {
        const sprite = playerSprite(index, frame);
        const occupied = sprite.rows.flatMap((row, y) =>
          [...row].flatMap((pixel, x) => (pixel === "." ? [] : [{ x, y }])),
        );
        expect(Math.min(...occupied.map((p) => p.x))).toBe(3);
        expect(Math.max(...occupied.map((p) => p.x))).toBe(12);
        expect(Math.min(...occupied.map((p) => p.y))).toBe(3);
        expect(Math.max(...occupied.map((p) => p.y))).toBe(12);
        for (const row of sprite.rows)
          expect([...row].reverse().join("")).toBe(row);
      }
    }
  });
  it("draws four exits only at a center or a real intersection, with straight ray edges", () => {
    for (const frame of [0, 1]) {
      const horizontal = flameSprite(frame, "horizontal").rows;
      const vertical = flameSprite(frame, "vertical").rows;
      const center = flameSprite(frame, "center").rows;
      expect(horizontal[0]).toBe("................");
      expect(horizontal[15]).toBe("................");
      expect(horizontal[7]?.[0]).not.toBe(".");
      expect(horizontal[7]?.[15]).not.toBe(".");
      expect(vertical.every((row) => row[0] === "." && row[15] === ".")).toBe(
        true,
      );
      expect(vertical[0]?.[7]).not.toBe(".");
      expect(vertical[15]?.[7]).not.toBe(".");
      expect(center[0]?.[7]).not.toBe(".");
      expect(center[7]?.[0]).not.toBe(".");
    }
  });
  it("blinks without hiding the footprint and uses a steady protection ring with reduced motion", () => {
    expect(protectionVisual(120, false)).toEqual({ shield: true, alpha: 1 });
    expect(protectionVisual(108, false)).toEqual({ shield: true, alpha: 0.35 });
    expect(protectionVisual(96, false)).toEqual({ shield: true, alpha: 1 });
    expect(protectionVisual(108, true)).toEqual({ shield: true, alpha: 1 });
    expect(protectionVisual(0, false)).toEqual({ shield: false, alpha: 1 });
  });
});
