import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
  type RealtimePlayerInput,
} from "@online-game-hub/realtime-game-sdk";
import type { Input } from "../../src/v1/contracts.js";
import { bombermanDefinition as game } from "../../src/v1/core/index.js";
import type { Bomb, State } from "../../src/v1/core/model.js";
import { cellCenter } from "../../src/v1/core/movement.js";

export type Frame = ReturnType<typeof game.createInitialState>;
export function initial(count = 2, seed = "bomberman-test"): Frame {
  return game.createInitialState({
    config: { mapId: "classic-arena", modeId: "classic", playerCount: count },
    players: Array.from({ length: count }, (_, index) =>
      defineRealtimePlayerSlotId("p" + index),
    ),
    rng: createRealtimeRng(seed),
  });
}
export function intent(
  index: number,
  input: Input,
): RealtimePlayerInput<Input> {
  return { slotId: defineRealtimePlayerSlotId("p" + index), input };
}
export function advance(
  frame: Frame,
  ticks = 1,
  inputs: readonly RealtimePlayerInput<Input>[] = [],
): Frame {
  let result = frame;
  for (let index = 0; index < ticks; index += 1)
    result = game.step({
      ...result,
      tick: result.state.tick,
      inputs: index === 0 ? inputs : [],
    });
  return result;
}
export function openArena(count = 2): Frame {
  const frame = advance(initial(count), 180);
  const { arena } = frame.state;
  arena.tiles = arena.tiles.map((_, cell) =>
    cell % arena.cols === 0 ||
    cell % arena.cols === arena.cols - 1 ||
    cell < arena.cols ||
    cell >= arena.cols * (arena.rows - 1)
      ? "wall"
      : "floor",
  );
  arena.concealed = [];
  frame.state.players.forEach((player, index) =>
    Object.assign(
      player,
      cellCenter(
        index === 0
          ? arena.cols + 1
          : (arena.rows - 2) * arena.cols + arena.cols - 2 - (index - 1) * 2,
        arena.cols,
      ),
    ),
  );
  return frame;
}
export function player(state: State, index = 0) {
  const result = state.players[index];
  if (!result) throw new Error("Missing test player");
  return result;
}
export function bomb(
  state: State,
  x: number,
  y: number,
  id = 1,
  range = 2,
  explodeAt = 0,
): Bomb {
  return {
    id,
    cell: y * state.arena.cols + x,
    ownerSlotId: "p0",
    range,
    explodeAt,
    passThrough: [],
  };
}
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
