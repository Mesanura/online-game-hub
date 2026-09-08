import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parsePlayView,
  playViewSchema,
  encodePlayIntent,
  type PlayView,
} from "../src/contracts";
import { ControlState, ServeRequest, KEY_CONTROLS } from "../src/model";
import {
  playerPose,
  projectPoint,
  shuttlePosition,
  ShuttleTrail,
  SoundTimeline,
} from "../src/presentation";

const fixture = () =>
  playViewSchema.parse(
    JSON.parse(
      readFileSync(new URL("./fixtures/play.json", import.meta.url), "utf8"),
    ),
  );
describe("exact versions and serve intent", () => {
  it("accepts the lowered net only for the new exact rule version", () => {
    const view = fixture();
    expect(() => parsePlayView(view, "1.2.0")).toThrow();
    view.court.netTop = 370_000;
    expect(parsePlayView(view, "1.2.0").court.netTop).toBe(370_000);
    expect(() => parsePlayView(view, "1.1.0")).toThrow();
  });
  it("keeps old view and input schemas isolated from manual serving", () => {
    const old = JSON.parse(
      readFileSync(new URL("./fixtures/play-v1.json", import.meta.url), "utf8"),
    );
    expect(parsePlayView(old, "1.0.0").phaseTicks).toBe(120);
    expect(() => parsePlayView(old, "1.1.0")).toThrow();
    expect(() => parsePlayView(fixture(), "1.0.0")).toThrow();
    const intent = {
      type: "CONTROL",
      move: 0,
      jump: false,
      serve: true,
      shot: "NONE",
    } as const;
    expect(encodePlayIntent(intent, "1.0.0")).not.toHaveProperty("serve");
    expect(encodePlayIntent(intent, "1.1.0")).toEqual(intent);
  });
  it("latches a quick serve until authoritative start and keeps other held controls", () => {
    const controls = new ControlState(),
      request = new ServeRequest(),
      view = fixture();
    expect(KEY_CONTROLS.KeyS).toBe("serve");
    controls.press("move", "left");
    controls.press("jump", "jump");
    controls.press("key-s", "serve");
    request.press(view);
    controls.release("key-s");
    expect(request.pending).toBe(true);
    expect(controls.intent()).toMatchObject({
      move: -1,
      jump: true,
      serve: false,
    });
    request.observe({ ...view, tick: 3 });
    expect(request.pending).toBe(true);
    request.observe({ ...view, phase: "SERVING" });
    expect(request.pending).toBe(false);
    request.press({ ...view, yourSide: "RIGHT" });
    expect(request.pending).toBe(false);
    request.press(view);
    request.reset();
    expect(request.pending).toBe(false);
  });
});

describe("court and skeleton geometry", () => {
  it.each([0, 1] as const)(
    "keeps side %s's rear leg straight and front knee slightly bent",
    (side) => {
      const view = fixture();
      const pose = playerPose(
        view,
        side,
        view.athletes[side].x,
        500000,
        0,
        false,
      );
      expect(pose.backKnee.x).toBeCloseTo((pose.hip.x + pose.backHeel.x) / 2);
      expect(pose.backKnee.y).toBeCloseTo((pose.hip.y + pose.backHeel.y) / 2);
      expect(
        Math.abs(pose.frontKnee.x - (pose.hip.x + pose.frontHeel.x) / 2),
      ).toBeGreaterThan(3);
      expect(pose.front.y - pose.head.y).toBe(113);
      expect(
        Math.hypot(pose.racket.x - pose.hand.x, pose.racket.y - pose.hand.y),
      ).toBeGreaterThan(45);
    },
  );
  it.each([0, 1] as const)(
    "plants side %s's front toe on the projected serve line without a gait",
    (side) => {
      const view = fixture();
      view.servingSide = side === 0 ? "LEFT" : "RIGHT";
      const x = side === 0 ? 340000 : 660000,
        line =
          side === 0 ? view.court.leftServeLine : view.court.rightServeLine;
      view.athletes[side].x = x;
      view.athletes[side].moving = true;
      const baseline = projectPoint(line, view.court.ground);
      for (const tick of [0, 2, 4, 7, 10])
        expect(playerPose(view, side, x, 500000, tick, false).front).toEqual(
          baseline,
        );
      const back = projectPoint(line, view.court.ground, 0),
        front = projectPoint(line, view.court.ground, 1);
      expect((back.x + front.x) / 2).toBe(baseline.x);
      expect(baseline.y).toBe(541);
    },
  );
  it("mirrors overhead and underhand arcs and aligns the racket at confirmed contact", () => {
    const view = fixture();
    view.phase = "RALLY";
    for (const kind of ["OVERHEAD", "UNDERHAND"] as const) {
      for (const p of view.athletes) {
        p.swingKind = kind;
        p.swingStartedTick = 10;
        p.swingTicks = 10;
      }
      const start = playerPose(view, 0, 240000, 500000, 10, false);
      const end = playerPose(view, 0, 240000, 500000, 18, false);
      expect(start.racket.x).toBeLessThan(start.shoulder.x);
      expect(end.racket.x).toBeGreaterThan(end.shoulder.x);
      expect(Math.sign(start.racket.y - start.shoulder.y)).toBe(
        kind === "OVERHEAD" ? -1 : 1,
      );
      for (const tick of [10, 14, 18]) {
        const left = playerPose(view, 0, 240000, 500000, tick, false),
          right = playerPose(view, 1, 760000, 500000, tick, false);
        expect(left.racket.x + right.racket.x).toBeCloseTo(1000);
        expect(left.racket.y).toBeCloseTo(right.racket.y);
      }
    }
    view.athletes[0].lastContact = {
      tick: 15,
      x: 280000,
      y: 420000,
      shot: "CLEAR",
    };
    expect(playerPose(view, 0, 240000, 500000, 15, false).racket).toEqual(
      projectPoint(280000, 420000),
    );
  });
  it("keeps the held shuttle at the free hand while moving or airborne", () => {
    const view = fixture();
    for (const side of [0, 1] as const) {
      view.servingSide = side === 0 ? "LEFT" : "RIGHT";
      const x = side === 0 ? 300000 : 700000,
        y = 370000;
      expect(playerPose(view, side, x, y, 20, false).freeHand).toEqual(
        projectPoint(x + (side === 0 ? 40000 : -40000), y - 70000),
      );
    }
  });
  it("segments interpolation through the exact contact rather than cutting across a return", () => {
    const previous = fixture(),
      current = fixture();
    previous.phase = "RALLY";
    current.phase = "RALLY";
    previous.tick = 10;
    current.tick = 16;
    previous.shuttle = { x: 300000, y: 400000 };
    current.shuttle = { x: 320000, y: 360000 };
    current.athletes[0].lastContact = {
      tick: 13,
      x: 280000,
      y: 420000,
      shot: "CLEAR",
    };
    expect(shuttlePosition(previous, current, 0.5)).toEqual({
      x: 280000,
      y: 420000,
    });
  });
});

describe("bounded effects and snapshot discontinuities", () => {
  it("emits sparse fading particles and clears on a new rally or disabled motion", () => {
    const trail = new ShuttleTrail();
    for (let t = 0; t < 1200; t += 10) {
      const points = trail.update({ x: t / 2, y: 20 }, t, true, "1:1");
      expect(points.length).toBeLessThanOrEqual(6);
    }
    expect(trail.update({ x: 600, y: 20 }, 1200, false, "1:1")).toEqual([]);
    expect(trail.update({ x: 0, y: 0 }, 1210, true, "2:1")).toHaveLength(1);
    expect(trail.update({ x: 0, y: 0 }, 1300, true, "2:1")).toHaveLength(1);
  });
  it("plays one swing and one confirmed hit at display time and never catches up after reconnect", () => {
    const timeline = new SoundTimeline(),
      view = fixture();
    view.phase = "RALLY";
    expect(timeline.consume(view, 0, "1", true)).toEqual([]);
    view.tick = 12;
    view.athletes[0].swingStartedTick = 10;
    view.athletes[0].swingShot = "SMASH";
    expect(timeline.consume(view, 9, "1", true)).toEqual([]);
    expect(timeline.consume(view, 10, "1", true)).toEqual([
      { kind: "swing", tick: 10, smash: true },
    ]);
    expect(timeline.consume(view, 12, "1", true)).toEqual([]);
    view.tick = 15;
    view.athletes[0].lastContact = {
      tick: 14,
      x: 280000,
      y: 300000,
      shot: "SMASH",
    };
    expect(timeline.consume(view, 13, "1", true)).toEqual([]);
    expect(timeline.consume(view, 14, "1", true)).toEqual([
      { kind: "hit", tick: 14, smash: true },
    ]);
    expect(timeline.consume(view, 15, "2", true)).toEqual([]);
    view.athletes[0].swingStartedTick = 20;
    view.tick = 20;
    expect(timeline.consume(view, 20, "2", false)).toEqual([]);
    expect(timeline.consume(view, 20, "2", true)).toEqual([]);
  });
  it("has no impact sound for a missed swing", () => {
    const timeline = new SoundTimeline(),
      view: PlayView = fixture();
    timeline.consume(view, 0, "rally", true);
    view.tick = 5;
    view.athletes[1].swingStartedTick = 5;
    expect(timeline.consume(view, 5, "rally", true).map((c) => c.kind)).toEqual(
      ["swing"],
    );
  });
});
