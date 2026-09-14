import {
  nextRealtimeInt,
  type RealtimeRngState,
} from "@online-game-hub/realtime-game-sdk";
import {
  pickupKinds,
  type MapDefinition,
  type ModeDefinition,
} from "../definitions.js";
import type { Arena, Tile } from "./model.js";

export function generateArena(
  map: MapDefinition,
  mode: ModeDefinition,
  inputRng: Readonly<RealtimeRngState>,
): { arena: Arena; rng: RealtimeRngState } {
  let rng = { ...inputRng };
  const draw = (max: number) => {
    const result = nextRealtimeInt(rng, max);
    rng = result.next;
    return result.value;
  };
  const walls = new Set(map.walls);
  const tiles: Tile[] = Array.from(
    { length: map.cols * map.rows },
    (_, index) => (walls.has(index) ? "wall" : "floor"),
  );
  const concealed: Arena["concealed"] = [];
  for (const group of map.brickGroups) {
    if (draw(100) >= map.brickPercent) continue;
    const kind =
      draw(100) < mode.lootPercent
        ? pickupKinds[draw(pickupKinds.length)]
        : undefined;
    for (const cell of group) {
      if (tiles[cell] !== "floor" || map.safeCells.includes(cell))
        throw new Error("Invalid brick group.");
      tiles[cell] = "brick";
      if (kind !== undefined) concealed.push({ cell, kind });
    }
  }
  return { arena: { cols: map.cols, rows: map.rows, tiles, concealed }, rng };
}
