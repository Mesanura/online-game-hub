import { expect, it } from "vitest";
import { parseView, type View } from "../src/contracts";
import { hasNewHit } from "../src/presentation";
import { WallSmoke } from "../src/wall-smoke";

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

it("emits black exhaust only for confirmed contact, once per snapshot, behind both tracks", () => {
  const smoke = new WallSmoke();
  const next = frame();
  smoke.update(next, 0, true);
  expect(smoke.sample(0)).toEqual([]);
  next.tick += 3;
  next.tanks[0] = { ...tank("p0"), x: 100000, y: 100000, wallContact: true };
  smoke.update(next, 50, true);
  const emitted = smoke.sample(50);
  expect(emitted).toHaveLength(2);
  expect(emitted.every((puff) => puff.x < 100)).toBe(true);
  expect(emitted[0]?.y).toBeLessThan(100);
  expect(emitted[1]?.y).toBeGreaterThan(100);
  smoke.update(next, 60, true);
  expect(smoke.sample(60)).toHaveLength(2);
  next.tick += 3;
  next.tanks = next.tanks.map((value) => ({ ...value, wallContact: false }));
  smoke.update(next, 100, true);
  const fading = smoke.sample(400);
  expect(fading).toHaveLength(2);
  expect(fading[0]?.radius).toBeGreaterThan(emitted[0]?.radius ?? Infinity);
  expect(fading[0]?.opacity).toBeLessThan(emitted[0]?.opacity ?? 0);
  expect(smoke.render(750)).toBe("");
});

it("bounds exhaust and clears it for death, preparation, reconnect reset and reduced motion", () => {
  const smoke = new WallSmoke();
  const next = frame();
  next.tanks = Array.from({ length: 8 }, (_, i) => ({
    ...tank(`p${i}`),
    wallContact: true,
  }));
  for (let i = 0; i < 60; i++) {
    next.tick += 3;
    smoke.update(next, i, true);
  }
  expect(smoke.sample(60).length).toBeLessThanOrEqual(256);
  next.tanks = next.tanks.map((value) => ({ ...value, alive: false }));
  smoke.update(next, 60, true);
  expect(smoke.sample(60)).toEqual([]);
  next.tanks = next.tanks.map((value) => ({ ...value, alive: true }));
  for (const reason of ["prepare", "reset", "reduced"]) {
    next.tick += 3;
    next.phase = "ACTIVE";
    smoke.update(next, 100, true);
    expect(smoke.sample(100).length).toBeGreaterThan(0);
    if (reason === "reset") smoke.reset();
    else {
      if (reason === "prepare") next.phase = "PREPARE";
      smoke.update(next, 100, reason !== "reduced");
    }
    expect(smoke.render(100)).toBe("");
  }
});

it("strictly separates legacy projections from the current shield/contact feedback", () => {
  const legacy = {
    ...frame(),
    selfSlotId: "p0",
    config: { playerCount: 2, targetScore: 5 },
    arena: { width: 600000, height: 500000, walls: [] },
    bullets: [],
    pickups: [],
    aims: [],
    phaseTicks: 0,
    outcome: null,
  };
  for (const version of ["1.0.0", "1.1.0", "1.2.0"])
    expect(parseView(legacy, version)).toEqual(legacy);
  expect(() => parseView(legacy, "1.3.0")).toThrow();
  const current = {
    ...legacy,
    tanks: legacy.tanks.map((value) => ({
      ...value,
      wallContact: true,
      shieldRadius: 36000,
    })),
  };
  expect(parseView(current, "1.3.0")).toEqual(current);
  expect(() => parseView(current, "1.2.0")).toThrow();
  expect(() =>
    parseView(
      {
        ...current,
        tanks: current.tanks.map((value) => ({ ...value, lease: 30 })),
      },
      "1.3.0",
    ),
  ).toThrow();
});
