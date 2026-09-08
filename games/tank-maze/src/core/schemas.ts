import { z } from "zod";
const integer = z.number().int().safe();
export const configSchema = z
  .object({
    playerCount: integer.min(2).max(8),
    targetScore: z.union([
      z.literal(5),
      z.literal(10),
      z.literal(15),
      z.literal(20),
    ]),
    colors: z.array(integer.min(0).max(7)).max(8),
  })
  .strict()
  .refine(
    (c) =>
      c.colors.length === 0 ||
      (c.colors.length === c.playerCount &&
        new Set(c.colors).size === c.colors.length),
    "Distinct participant colors required",
  );
export const inputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("MOVE"),
      move: integer.min(-1).max(1),
      turn: integer.min(-1).max(1),
    })
    .strict(),
  z.object({ type: z.literal("FIRE") }).strict(),
  z.object({ type: z.literal("RESIGN") }).strict(),
]);
export const weaponSchema = z.enum([
  "normal",
  "laser",
  "missile",
  "machine",
  "shotgun",
]);
export const pickupKindSchema = z.enum([
  "laser",
  "missile",
  "machine",
  "shield",
  "shotgun",
]);
export type Config = z.infer<typeof configSchema>;
export type Input = z.infer<typeof inputSchema>;
export type Weapon = z.infer<typeof weaponSchema>;
export type PickupKind = z.infer<typeof pickupKindSchema>;
export type Wall = { x: number; y: number; w: number; h: number };
export type Arena = {
  width: number;
  height: number;
  cols: number;
  rows: number;
  walls: Wall[];
  cells: number[];
};
export type Tank = {
  slotId: string;
  color: number;
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  resigned: boolean;
  score: number;
  weapon: Weapon;
  ammo: number;
  shield: number;
  move: number;
  turn: number;
  lease: number;
};
export type Bullet = {
  id: number;
  owner: string;
  kind: Weapon;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  radius: number;
  target: string | null;
  trail: { x: number; y: number }[];
};
export type Pickup = {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  life: number;
};
export type Outcome = {
  type: "WIN" | "DRAW";
  winnerSlotId: string | null;
  reason: "SCORE" | "RESIGNATION";
  scores: { slotId: string; score: number }[];
};
export type State = {
  tick: number;
  config: Config;
  arena: Arena;
  tanks: Tank[];
  bullets: Bullet[];
  pickups: Pickup[];
  phase: "PREPARE" | "ACTIVE" | "LAST" | "COMPLETE";
  phaseTicks: number;
  elapsed: number;
  bout: number;
  nextPickup: number;
  nextId: number;
  outcome: Outcome | null;
  events: {
    id: number;
    kind: "fire" | "bounce" | "hit" | "pickup";
    x: number;
    y: number;
  }[];
};
