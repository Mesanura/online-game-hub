import {
  nextRealtimeInt,
  type RealtimeRngState,
} from "@online-game-hub/realtime-game-sdk";
import {
  pickupKinds,
  type ModeDefinition,
  type PickupKind,
} from "../definitions.js";
import type { Player, State } from "./model.js";
import { overlapsCell } from "./movement.js";

/** Run after the complete damage batch, so simultaneous hits share occupancy. */
export function dropHitUpgrades(
  state: State,
  hitPlayers: readonly Player[],
  mode: ModeDefinition,
  inputRng: Readonly<RealtimeRngState>,
): RealtimeRngState {
  let rng = { ...inputRng };
  if (hitPlayers.length === 0) return rng;
  const occupied = new Set([
    ...state.bombs.map((bomb) => bomb.cell),
    ...state.flames.map((flame) => flame.cell),
    ...state.pickups.map((pickup) => pickup.cell),
    ...state.pendingLoot.map((pickup) => pickup.cell),
  ]);
  const freeCells = state.arena.tiles.flatMap((tile, cell) =>
    tile === "floor" &&
    !occupied.has(cell) &&
    !state.players.some(
      (player) =>
        player.alive &&
        overlapsCell(player.x, player.y, cell, state.arena.cols),
    )
      ? [cell]
      : [],
  );
  for (const player of [...hitPlayers].sort((a, b) => a.index - b.index)) {
    // Only effective, currently held upgrades count; capped pickups are not banked.
    const amounts: Record<PickupKind, number> = {
      capacity: player.capacity - mode.initialCapacity,
      range: player.range - mode.initialRange,
      speed: (player.speed - mode.initialSpeed) / mode.speedIncrement,
    };
    const held: PickupKind[] = [];
    for (const kind of pickupKinds)
      for (let count = 0; count < amounts[kind]; count += 1) held.push(kind);
    const count = Math.min(
      freeCells.length,
      Math.floor((held.length * mode.damageDropPercent) / 100),
    );
    for (let index = 0; index < count; index += 1) {
      const itemDraw = nextRealtimeInt(rng, held.length);
      const cellDraw = nextRealtimeInt(itemDraw.next, freeCells.length);
      rng = cellDraw.next;
      const kind = held.splice(itemDraw.value, 1)[0];
      const cell = freeCells.splice(cellDraw.value, 1)[0];
      if (kind === undefined || cell === undefined)
        throw new Error("Invalid Bomberman drop candidate.");
      if (kind === "speed") player.speed -= mode.speedIncrement;
      else player[kind] -= 1;
      state.pickups.push({ cell, kind });
    }
  }
  return rng;
}
