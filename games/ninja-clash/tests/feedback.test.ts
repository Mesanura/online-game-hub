import { expect, it } from "vitest";
import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";
import {
  ninjaClashDefinition as game,
  type State,
  type Input,
} from "../src/core/index.js";
const rng = createRealtimeRng("feedback");
function step(state: State, inputs: { slotId: string; input: Input }[] = []) {
  return game.step({
    state,
    inputs: inputs.map((e) => ({
      ...e,
      slotId: defineRealtimePlayerSlotId(e.slotId),
    })),
    rng,
    tick: state.tick,
  }).state;
}
function advance(state: State, ticks: number) {
  for (let i = 0; i < ticks; i++) state = step(state);
  return state;
}
function active(count = 2) {
  return advance(
    game.createInitialState({
      config: { playerCount: count, targetScore: 3 },
      players: Array.from({ length: count }, (_, i) =>
        defineRealtimePlayerSlotId("p" + i),
      ),
      rng,
    }).state,
    180,
  );
}
function event(type: "ATTACK" | "SLIDE" | "JUMP" | "RESIGN", slotId = "p0") {
  return { slotId, input: { type } };
}
function clash(count = 2) {
  const s = active(count);
  Object.assign(required(s.players[0]), { x: 30000, facing: 1 });
  Object.assign(required(s.players[1]), { x: 34500, facing: -1 });
  return advance(step(s, [event("ATTACK"), event("ATTACK", "p1")]), 3);
}
it.each([2, 3, 4])(
  "places one clash at the blade intersection and freezes all %i players for six ticks",
  (count) => {
    let s = clash(count);
    const impact = s.effects.filter((e) => e.kind === "CLASH");
    expect(impact).toHaveLength(1);
    expect(impact[0]).toMatchObject({
      x: 32250,
      y: 32400,
      sourceSlotId: "p0",
      targetSlotId: "p1",
    });
    expect(s.hitstopTicks).toBe(6);
    const actionTick = s.actionTick,
      positions = s.players.map((p) => [p.x, p.y, p.vx, p.vy]);
    const ready = s.players.map((p) => p.attackReady);
    for (let i = 0; i < 6; i++) {
      s = step(s);
      expect(s.actionTick).toBe(actionTick);
      expect(s.players.map((p) => [p.x, p.y, p.vx, p.vy])).toEqual(positions);
      expect(s.players.map((p) => p.attackReady)).toEqual(ready);
      expect(s.hitstopTicks).toBe(5 - i);
    }
    s = step(s);
    expect(s.actionTick).toBe(actionTick + 1);
  },
);
it("projects a frozen pose and timers while transport ticks continue", () => {
  let s = clash();
  const view = () =>
    game.projectView({
      state: s,
      viewer: { kind: "player", slotId: defineRealtimePlayerSlotId("p0") },
    });
  const first = view();
  expect(first.players[0]?.motion).toBe("CLASH");
  s = advance(s, 3);
  expect(view().animationTick).toBe(first.animationTick);
  expect(view().tick).toBe(first.tick + 3);
  expect(view().players[0]?.attackCooldown).toBe(
    first.players[0]?.attackCooldown,
  );
  expect(view().players[0]).not.toHaveProperty("bufferedAction");
});
it("buffers a counterattack during hitstop and consumes it once when ready", () => {
  let s = clash();
  s = step(s, [event("ATTACK")]);
  s = advance(s, 5);
  expect(required(s.players[0]).bufferedAction).toBe("ATTACK");
  const expected = required(s.players[0]).attackReady;
  s = advance(s, 3);
  expect(required(s.players[0]).attackStart).toBe(expected);
  expect(required(s.players[0]).bufferedAction).toBeNull();
  expect(
    s.effects.filter((e) => e.kind === "ATTACK" && e.startedAt >= 184),
  ).toHaveLength(1);
});
it("last buffered action wins and movement does not move or turn the frozen fighter", () => {
  let s = clash();
  const x = required(s.players[0]).x;
  s = step(s, [
    event("ATTACK"),
    event("JUMP"),
    { slotId: "p0", input: { type: "MOVE", direction: -1 } },
  ]);
  expect(required(s.players[0]).x).toBe(x);
  expect(required(s.players[0]).facing).toBe(1);
  s = advance(s, 5);
  s = step(s);
  expect(required(s.players[0]).x).toBeLessThan(x);
  expect(required(s.players[0]).vy).toBeLessThan(0);
  expect(s.effects.filter((e) => e.kind === "JUMP")).toHaveLength(1);
});
it("never stacks global hitstop for a multi-player clash", () => {
  let s = active(3);
  Object.assign(required(s.players[0]), { x: 30000, y: 33600, facing: 1 });
  Object.assign(required(s.players[1]), { x: 34500, y: 33600, facing: -1 });
  Object.assign(required(s.players[2]), { x: 34700, y: 33600, facing: -1 });
  s = advance(
    step(s, [event("ATTACK"), event("ATTACK", "p1"), event("ATTACK", "p2")]),
    3,
  );
  expect(s.effects.filter((e) => e.kind === "CLASH")).toHaveLength(3);
  expect(s.hitstopTicks).toBe(6);
  expect(s.players.every((p) => p.alive)).toBe(true);
});
it("reports only actual ground and wall jumps, not invalid air taps", () => {
  let s = active();
  s = step(s, [event("JUMP")]);
  expect(s.effects.filter((e) => e.kind === "JUMP")).toHaveLength(1);
  s = step(s, [event("JUMP")]);
  expect(s.effects.filter((e) => e.kind === "JUMP")).toHaveLength(1);
  s = active();
  Object.assign(required(s.players[0]), {
    x: 2200,
    y: 24000,
    grounded: false,
    wall: -1,
  });
  s = step(s, [event("JUMP")]);
  expect(s.effects.filter((e) => e.kind === "WALL_JUMP")).toHaveLength(1);
});
it.each([false, true])(
  "keeps the killing event across score transitions (terminal=%s)",
  (terminal) => {
    let s = active();
    Object.assign(required(s.players[0]), {
      x: 30000,
      facing: 1,
      score: terminal ? 2 : 0,
    });
    Object.assign(required(s.players[1]), { x: 33000 });
    s = advance(step(s, [event("ATTACK")]), 3);
    expect(s.phase).toBe(terminal ? "FINISHED" : "COUNTDOWN");
    expect(s.effects.find((e) => e.kind === "DEATH")).toMatchObject({
      x: 33000,
      y: 32400,
      sourceSlotId: "p0",
      targetSlotId: "p1",
      startedAt: 183,
    });
    expect(s.hitstopTicks).toBe(0);
  },
);
it("resignation terminates a hitstop immediately and does not create a kill", () => {
  const s = step(clash(), [event("RESIGN", "p1")]);
  expect(s.outcome?.reason).toBe("RESIGNATION");
  expect(s.hitstopTicks).toBe(0);
  expect(s.effects.some((e) => e.kind === "DEATH")).toBe(false);
});
it("preserves immutability and serializes hitstop and buffered commands", () => {
  const state = clash();
  const before = JSON.stringify(state);
  Object.freeze(state);
  state.players.forEach(Object.freeze);
  const next = step(state, [event("ATTACK")]);
  expect(JSON.stringify(state)).toBe(before);
  expect(step(JSON.parse(JSON.stringify(next)))).toEqual(step(next));
});
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fighter");
  return value;
}
