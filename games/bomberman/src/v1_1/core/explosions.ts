import type { ModeDefinition } from "../definitions.js";
import type { Flame, State } from "./model.js";

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
  const burned = new Map<number, Flame>();
  const expiresAt = state.elapsed + mode.flameTicks;
  function burn(
    cell: number,
    part: "centerUntil" | "horizontalUntil" | "verticalUntil",
  ) {
    const flame = burned.get(cell) ?? {
      cell,
      expiresAt,
      centerUntil: 0,
      horizontalUntil: 0,
      verticalUntil: 0,
    };
    flame[part] = expiresAt;
    burned.set(cell, flame);
  }
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
    burn(bomb.cell, "centerUntil");
    for (const [dx, dy] of directions) {
      for (let distance = 1; distance <= bomb.range; distance += 1) {
        const x = (bomb.cell % state.arena.cols) + dx * distance;
        const y = Math.floor(bomb.cell / state.arena.cols) + dy * distance;
        if (x < 0 || y < 0 || x >= state.arena.cols || y >= state.arena.rows)
          break;
        const cell = y * state.arena.cols + x;
        if (tiles[cell] === "wall") break;
        burn(cell, dx === 0 ? "verticalUntil" : "horizontalUntil");
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
  const flames = new Map(state.flames.map((flame) => [flame.cell, flame]));
  for (const [cell, flame] of burned) {
    const previous = flames.get(cell);
    flames.set(cell, {
      cell,
      expiresAt: Math.max(previous?.expiresAt ?? 0, expiresAt),
      centerUntil: Math.max(previous?.centerUntil ?? 0, flame.centerUntil),
      horizontalUntil: Math.max(
        previous?.horizontalUntil ?? 0,
        flame.horizontalUntil,
      ),
      verticalUntil: Math.max(
        previous?.verticalUntil ?? 0,
        flame.verticalUntil,
      ),
    });
  }
  state.flames = [...flames.values()].sort((a, b) => a.cell - b.cell);
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
