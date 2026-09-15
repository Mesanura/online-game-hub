import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";
import {
  ninjaClashDefinition as game,
  type State,
  type Input,
} from "../src/core/index.js";
export const rng = createRealtimeRng("ninja-test");
export function initial(count = 2): State {
  return game.createInitialState({
    config: { playerCount: count, targetScore: 3 },
    players: Array.from({ length: count }, (_, i) =>
      defineRealtimePlayerSlotId("p" + i),
    ),
    rng,
  }).state;
}
export function step(
  state: State,
  inputs: { slotId: string; input: Input }[] = [],
): State {
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
export function advance(state: State, n: number): State {
  for (let i = 0; i < n; i++) state = step(state);
  return state;
}
export function active(count = 2): State {
  return advance(initial(count), 180);
}
export function event(
  type: "JUMP" | "ATTACK" | "SLIDE" | "RESIGN",
  slotId = "p0",
) {
  return { slotId: defineRealtimePlayerSlotId(slotId), input: { type } };
}
export function move(direction: -1 | 0 | 1, slotId = "p0") {
  return {
    slotId: defineRealtimePlayerSlotId(slotId),
    input: { type: "MOVE" as const, direction },
  };
}
export function duel(count = 2): State {
  const s = active(count);
  required(s.players[0]).x = 30000;
  required(s.players[1]).x = 33000;
  required(s.players[0]).facing = 1;
  required(s.players[1]).facing = -1;
  return s;
}
export function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected value to be present");
  return value;
}
