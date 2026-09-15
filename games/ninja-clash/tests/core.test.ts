import { expect, it } from "vitest";
import {
  ninjaClashDefinition as game,
  configSchema,
  inputSchema,
} from "../src/v1/core/index.js";
import {
  active,
  advance,
  duel,
  event,
  freeze,
  initial,
  move,
  rng,
  step,
} from "./helpers.js";
it.each([2, 3, 4])(
  "counts down exactly 180 ticks and ignores early actions (%i)",
  (count) => {
    let s = initial(count);
    const before = s.players.map((p) => [p.x, p.y]);
    s = step(s, [move(1), event("ATTACK"), event("JUMP"), event("SLIDE")]);
    s = advance(s, 178);
    expect(s.phase).toBe("COUNTDOWN");
    expect(s.countdown).toBe(1);
    s = step(s);
    expect(s.phase).toBe("ACTIVE");
    expect(s.players.map((p) => [p.x, p.y])).toEqual(before);
    expect(required(s.players[0]).move).toBe(0);
  },
);
it("rejects invalid config/input and forged state", () => {
  for (const count of [1, 5, 2.5])
    expect(
      configSchema.safeParse({ playerCount: count, targetScore: 3 }).success,
    ).toBe(false);
  for (const targetScore of [0, 4, 5.5, 20])
    expect(
      configSchema.safeParse({ playerCount: 2, targetScore }).success,
    ).toBe(false);
  for (const input of [
    { type: "MOVE", direction: 2 },
    { type: "ATTACK", actor: "p1" },
    { type: "SLIDE", x: 0 },
    { type: "FLY" },
  ])
    expect(inputSchema.safeParse(input).success).toBe(false);
  expect(() =>
    game.createInitialState({
      config: { playerCount: 2, targetScore: 3 },
      players: [event("ATTACK").slotId, event("ATTACK").slotId],
      rng,
    }),
  ).toThrow();
});
it("expires movement after 30 ticks and stops against walls without tunnelling", () => {
  let s = active();
  s = step(s, [move(-1)]);
  s = advance(s, 29);
  expect(required(s.players[0]).x).toBe(2200);
  s = step(s);
  expect(required(s.players[0]).move).toBe(0);
  s = step(s, [event("SLIDE")]);
  expect(required(s.players[0]).x).toBe(2200);
  expect(required(s.players[0]).slideUntil).toBeLessThanOrEqual(s.tick);
});
it("jumps, cannot double jump or slide in air, and lands", () => {
  let s = active();
  s = step(s, [event("JUMP")]);
  const y = required(s.players[0]).y;
  expect(y).toBeLessThan(33600);
  s = step(s, [event("JUMP"), event("SLIDE")]);
  expect(required(s.players[0]).slideUntil).toBe(0);
  expect(required(s.players[0]).vy).toBeGreaterThan(-600);
  s = advance(s, 60);
  expect(required(s.players[0]).grounded).toBe(true);
});
it("buffers a jump before landing and preserves six-tick coyote window", () => {
  let s = active();
  const p = required(s.players[0]);
  p.y = 33400;
  p.vy = 250;
  p.grounded = false;
  p.coyoteUntil = 0;
  s = step(s, [event("JUMP")]);
  s = step(s);
  expect(required(s.players[0]).vy).toBeLessThan(0);
  s = active();
  required(s.players[0]).y = 33000;
  required(s.players[0]).grounded = false;
  required(s.players[0]).coyoteUntil = s.tick + 6;
  s = step(s, [event("JUMP")]);
  expect(required(s.players[0]).vy).toBeLessThan(0);
});
it("wall slides and permits repeated jumps from the same wall", () => {
  let s = active();
  Object.assign(required(s.players[0]), {
    x: 2200,
    y: 24000,
    vy: 400,
    grounded: false,
    wall: -1,
  });
  s = step(s, [move(-1)]);
  expect(required(s.players[0]).vy).toBe(100);
  s = step(s, [event("JUMP")]);
  expect(required(s.players[0]).vx).toBe(400);
  expect(required(s.players[0]).vy).toBeLessThan(0);
  s = advance(s, 7);
  Object.assign(required(s.players[0]), {
    x: 2200,
    y: 24000,
    wall: -1,
    grounded: false,
  });
  s = step(s, [event("JUMP")]);
  expect(required(s.players[0]).vx).toBe(400);
});
it("enforces attack windup, then slide cancels its recovery and attack cancels invulnerability", () => {
  let s = duel();
  s = step(s, [event("ATTACK"), event("SLIDE")]);
  expect(required(s.players[0]).slideUntil).toBe(0);
  s = advance(s, 2);
  s = step(s, [event("SLIDE")]);
  expect(required(s.players[0]).slideUntil).toBe(s.tick - 1 + 18);
  expect(required(s.players[0]).attackReady).toBe(s.tick - 1);
  s = step(s, [event("ATTACK")]);
  expect(required(s.players[0]).slideUntil).toBe(s.tick - 1);
  expect(required(s.players[0]).slideReady).toBe(s.tick - 1 + 3);
  expect(required(s.players[0]).attackStart).toBe(s.tick - 1);
});
it("grants precisely 18 slide ticks then three cooldown ticks", () => {
  let s = active();
  required(s.players[0]).x = 26000;
  const t = s.tick;
  s = step(s, [event("SLIDE")]);
  expect(required(s.players[0]).slideUntil).toBe(t + 18);
  s = advance(s, 17);
  expect(required(s.players[0]).slideUntil).toBe(s.tick);
  s = step(s, [event("SLIDE")]);
  expect(required(s.players[0]).slideUntil).toBe(t + 18);
  s = advance(s, 2);
  s = step(s, [event("SLIDE")]);
  expect(required(s.players[0]).slideUntil).toBe(t + 39);
});
it("ends slide on ledge exit with immediate loss of invulnerability", () => {
  let s = active();
  Object.assign(required(s.players[0]), { x: 19000, y: 27200 });
  s = step(s, [event("SLIDE")]);
  s = step(s);
  expect(required(s.players[0]).grounded).toBe(false);
  expect(required(s.players[0]).slideUntil).toBeLessThanOrEqual(s.tick);
});
it("kills once and resets immediately, then finishes at target score", () => {
  let s = duel();
  required(s.players[0]).score = 2;
  s = step(s, [event("ATTACK")]);
  s = advance(s, 2);
  expect(s.outcome).toBeNull();
  s = step(s);
  expect(s.outcome).toMatchObject({
    type: "WIN",
    winnerSlotId: "p0",
    reason: "TARGET_SCORE",
  });
  expect(required(s.players[0]).score).toBe(3);
  expect(step(s, [event("RESIGN")])).toEqual(s);
  s = duel();
  s = advance(step(s, [event("ATTACK")]), 3);
  expect(s.round).toBe(2);
  expect(s.countdown).toBe(180);
  expect(s.players.every((p) => p.alive)).toBe(true);
});
it("clashes simultaneously and allows the next attack after only 3 ticks", () => {
  let s = duel();
  required(s.players[1]).x = 34500;
  s = advance(step(s, [event("ATTACK"), event("ATTACK", "p1")]), 3);
  expect(s.round).toBe(1);
  expect(s.effects.filter((e) => e.kind === "CLASH")).toHaveLength(2);
  const ready = required(s.players[0]).attackReady;
  s = step(s, [event("ATTACK")]);
  expect(required(s.players[0]).attackStart).toBe(-100);
  s = advance(s, 1);
  s = step(s, [event("ATTACK")]);
  expect(required(s.players[0]).attackStart).toBe(ready);
});
it("clashed blades cannot kill a third player", () => {
  let s = duel(3);
  required(s.players[1]).x = 34500;
  Object.assign(required(s.players[2]), { x: 32000, y: 33600 });
  s = advance(step(s, [event("ATTACK"), event("ATTACK", "p1")]), 3);
  expect(s.players.every((p) => p.alive)).toBe(true);
});
it("resolves close simultaneous kills as a draw round without seat advantage", () => {
  let s = duel();
  required(s.players[1]).x = 31000;
  s = advance(step(s, [event("ATTACK"), event("ATTACK", "p1")]), 3);
  expect(s.round).toBe(2);
  expect(s.players.map((p) => p.score)).toEqual([0, 0]);
  expect(s.lastWinner).toBeNull();
});
it("prevents damage through walls and ignores invulnerable targets", () => {
  let s = duel(3);
  Object.assign(required(s.players[0]), { x: 17000, y: 20800 });
  Object.assign(required(s.players[1]), { x: 19000, y: 23200 });
  s = advance(step(s, [event("ATTACK")]), 3);
  expect(required(s.players[1]).alive).toBe(true);
  s = duel(3);
  required(s.players[1]).slideUntil = s.tick + 20;
  required(s.players[1]).slideFacing = -1;
  s = advance(step(s, [event("ATTACK")]), 3);
  expect(required(s.players[1]).alive).toBe(true);
});
it("supports spectator deaths and permanent resignations including all-resign draws", () => {
  let s = duel(3);
  s = advance(step(s, [event("ATTACK")]), 3);
  expect(required(s.players[1]).alive).toBe(false);
  expect(s.phase).toBe("ACTIVE");
  const x = required(s.players[1]).x;
  s = step(s, [move(1, "p1")]);
  expect(required(s.players[1]).x).toBe(x);
  s = step(s, [event("RESIGN", "p1"), event("RESIGN", "p2")]);
  expect(s.outcome?.winnerSlotId).toBe("p0");
  s = step(initial(), [event("RESIGN"), event("RESIGN", "p1")]);
  expect(s.outcome?.type).toBe("DRAW");
});
it("has no round timeout, preserves inputs, serializes, and projects no internal controls", () => {
  const s = freeze(active());
  const inputs = freeze([move(1), event("ATTACK")]);
  const copy = JSON.stringify(s);
  const result = game.step({
    state: s,
    inputs,
    rng: freeze(rng),
    tick: s.tick,
  });
  expect(JSON.stringify(s)).toBe(copy);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  const view = game.projectView({
    state: result.state,
    viewer: { kind: "player", slotId: event("ATTACK").slotId },
  });
  for (const key of [
    "move",
    "leaseUntil",
    "gravityRemainder",
    "rng",
    "jumpUntil",
  ])
    expect(view.players[0]).not.toHaveProperty(key);
  expect(advance(active(), 5500).phase).toBe("ACTIVE");
  expect(
    game.step({ state: JSON.parse(copy), inputs, rng, tick: s.tick }),
  ).toEqual(result);
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected value to be present");
  return value;
}
