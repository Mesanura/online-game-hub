import type { ModeDefinition } from "../definitions.js";
import type { State } from "./model.js";

/** Every ray reads the same terrain/bomb snapshot, including already-triggered bombs. */
export function resolveExplosions(
  state: State,
  mode: ModeDefinition,
): number[] {
  const tiles = state.arena.tiles;
  const bombsByCell = new Map(state.bombs.map((bomb) => [bomb.cell, bomb]));
  const oldFlames = new Set(state.flames.map((flame) => flame.cell));
  const queue = state.bombs
    .filter(
      (bomb) => bomb.explodeAt <= state.elapsed || oldFlames.has(bomb.cell),
    )
    .map((bomb) => bomb.id)
    .sort((a, b) => a - b);
  const exploded = new Set<number>();
  const burned = new Set<number>();
  const destroyed = new Set<number>();
  const origins: number[] = [];
  const directions = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const;
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    if (id === undefined || exploded.has(id)) continue;
    const bomb = state.bombs.find((entry) => entry.id === id);
    if (!bomb) continue;
    exploded.add(id);
    origins.push(bomb.cell);
    burned.add(bomb.cell);
    for (const [dx, dy] of directions) {
      for (let distance = 1; distance <= bomb.range; distance += 1) {
        const x = (bomb.cell % state.arena.cols) + dx * distance;
        const y = Math.floor(bomb.cell / state.arena.cols) + dy * distance;
        if (x < 0 || y < 0 || x >= state.arena.cols || y >= state.arena.rows)
          break;
        const cell = y * state.arena.cols + x;
        if (tiles[cell] === "wall") break;
        burned.add(cell);
        if (tiles[cell] === "brick") {
          destroyed.add(cell);
          break;
        }
        const next = bombsByCell.get(cell);
        if (next) {
          if (!exploded.has(next.id)) queue.push(next.id);
          break;
        }
      }
    }
  }
  state.bombs = state.bombs.filter((bomb) => !exploded.has(bomb.id));
  const flameEnds = new Map(
    state.flames.map((flame) => [flame.cell, flame.expiresAt]),
  );
  for (const cell of burned)
    flameEnds.set(
      cell,
      Math.max(flameEnds.get(cell) ?? 0, state.elapsed + mode.flameTicks),
    );
  state.flames = [...flameEnds]
    .sort(([a], [b]) => a - b)
    .map(([cell, expiresAt]) => ({ cell, expiresAt }));
  state.arena.tiles = tiles.map((tile, cell) =>
    destroyed.has(cell) ? "floor" : tile,
  );
  state.pendingLoot.push(
    ...state.arena.concealed.filter((loot) => destroyed.has(loot.cell)),
  );
  state.arena.concealed = state.arena.concealed.filter(
    (loot) => !destroyed.has(loot.cell),
  );
  state.pickups = state.pickups.filter((pickup) => !burned.has(pickup.cell));
  return origins;
}
