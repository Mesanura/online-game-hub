import type { Config, Direction, Outcome } from "../contracts.js";
import type { PickupKind } from "../definitions.js";

export type Tile = "floor" | "wall" | "brick";
export type Loot = { cell: number; kind: PickupKind };
export type Arena = {
  cols: number;
  rows: number;
  tiles: Tile[];
  concealed: Loot[];
};
export type Player = {
  slotId: string;
  index: number;
  x: number;
  y: number;
  alive: boolean;
  resigned: boolean;
  lives: number;
  invulnerableUntil: number;
  capacity: number;
  range: number;
  speed: number;
  direction: Direction;
  facing: Exclude<Direction, "none">;
  lease: number;
  walking: boolean;
};
export type Bomb = {
  id: number;
  cell: number;
  ownerSlotId: string;
  range: number;
  explodeAt: number;
  passThrough: string[];
};
export type Flame = {
  cell: number;
  expiresAt: number;
  centerUntil: number;
  horizontalUntil: number;
  verticalUntil: number;
};
export type Effect = {
  id: number;
  kind: "place" | "explode" | "pickup" | "hit" | "eliminate";
  x: number;
  y: number;
  tick: number;
};
export type State = {
  tick: number;
  config: Config;
  arena: Arena;
  players: Player[];
  bombs: Bomb[];
  flames: Flame[];
  pickups: Loot[];
  pendingLoot: Loot[];
  phase: "PREPARE" | "ACTIVE" | "COMPLETE";
  phaseTicks: number;
  elapsed: number;
  nextId: number;
  events: Effect[];
  outcome: Outcome | null;
};
