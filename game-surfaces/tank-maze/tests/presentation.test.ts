import { expect, it } from "vitest";
import type { View } from "../src/contracts";
import { hasNewHit } from "../src/presentation";

const tank = (slotId: string): View["tanks"][number] => ({
  slotId,
  color: 0,
  x: 0,
  y: 0,
  angle: 0,
  alive: true,
  resigned: false,
  score: 0,
  weapon: "normal",
  ammo: 0,
  shield: 0,
  normalCount: 0,
});
const frame = () => ({
  tick: 20,
  bout: 1,
  phase: "ACTIVE" as View["phase"],
  elapsed: 200,
  tanks: [tank("p0"), tank("p1")],
  events: [] as View["events"],
});

it("triggers once for new hit events, including a simultaneous round reset", () => {
  const old = frame(),
    next = frame();
  next.tick++;
  next.bout++;
  next.events = [{ id: 4, kind: "hit", x: 10000, y: 10000 }];
  expect(hasNewHit(old, next, 3)).toBe(true);
  expect(hasNewHit(next, next, 4)).toBe(false);
  expect(hasNewHit(null, next, 0)).toBe(false);
});

it("detects destruction when snapshots skip the event tick, but not resignations", () => {
  const old = frame(),
    next = frame();
  next.tick += 3;
  next.tanks = next.tanks.map((t) => ({ ...t, alive: false }));
  expect(hasNewHit(old, next, 0)).toBe(true);
  expect(hasNewHit(next, next, 0)).toBe(false);
  next.tanks = next.tanks.map((t) => ({ ...t, resigned: true }));
  expect(hasNewHit(old, next, 0)).toBe(false);
  expect(hasNewHit(next, old, 0)).toBe(false);
});

it("detects a skipped final elimination across a bout change without confusing score or timeout resets", () => {
  const previous = frame();
  const next = frame();
  next.tick += 3;
  next.bout++;
  next.phase = "PREPARE";
  next.elapsed = 0;
  expect(hasNewHit(previous, next, 0)).toBe(true);
  expect(hasNewHit(next, next, 0)).toBe(false);
  next.tanks = next.tanks.map((tank) => ({ ...tank, score: 1 }));
  expect(hasNewHit(previous, next, 0)).toBe(false);
  next.tanks = next.tanks.map((tank) => ({ ...tank, score: 0 }));
  previous.elapsed = 7198;
  expect(hasNewHit(previous, next, 0)).toBe(false);
  previous.phase = "LAST";
  expect(hasNewHit(previous, next, 0)).toBe(true);
  previous.phase = "PREPARE";
  expect(hasNewHit(previous, next, 0)).toBe(false);
});
