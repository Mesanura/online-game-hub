import { z } from "zod";
const int = z.number().int().safe(),
  point = z.object({ x: int, y: int }).strict();
const weapon = z.enum(["normal", "laser", "missile", "machine", "shotgun"]);
const pickup = z.enum(["laser", "missile", "machine", "shield", "shotgun"]);
const outcome = z
  .object({
    type: z.enum(["WIN", "DRAW"]),
    winnerSlotId: z.string().nullable(),
    reason: z.enum(["SCORE", "RESIGNATION"]),
    scores: z
      .array(
        z.object({ slotId: z.string(), score: int.nonnegative() }).strict(),
      )
      .min(2)
      .max(8),
  })
  .strict();
export const viewSchema = z
  .object({
    tick: int.nonnegative(),
    selfSlotId: z.string(),
    config: z
      .object({ playerCount: int.min(2).max(8), targetScore: int.positive() })
      .strict(),
    arena: z
      .object({
        width: int.positive(),
        height: int.positive(),
        walls: z
          .array(
            z
              .object({ x: int, y: int, w: int.positive(), h: int.positive() })
              .strict(),
          )
          .max(300),
      })
      .strict(),
    tanks: z
      .array(
        z
          .object({
            slotId: z.string(),
            color: int.min(0).max(7),
            x: int,
            y: int,
            angle: int.min(0).max(719),
            alive: z.boolean(),
            resigned: z.boolean(),
            score: int.nonnegative(),
            weapon,
            ammo: int.nonnegative(),
            shield: int.nonnegative(),
            normalCount: int.min(0).max(5),
          })
          .strict(),
      )
      .min(2)
      .max(8),
    bullets: z
      .array(
        z
          .object({
            id: int,
            owner: z.string(),
            kind: weapon,
            x: int,
            y: int,
            vx: int,
            vy: int,
            age: int.nonnegative(),
            life: int.positive(),
            radius: int.positive(),
            target: z.string().nullable(),
            trail: z.array(point).max(64),
          })
          .strict(),
      )
      .max(2048),
    pickups: z
      .array(
        z
          .object({
            id: int,
            kind: pickup,
            x: int,
            y: int,
            life: int.positive(),
          })
          .strict(),
      )
      .max(3),
    aims: z
      .array(
        z
          .object({ slotId: z.string(), points: z.array(point).max(42) })
          .strict(),
      )
      .max(8),
    phase: z.enum(["PREPARE", "ACTIVE", "LAST", "COMPLETE"]),
    phaseTicks: int.nonnegative(),
    elapsed: int.nonnegative(),
    bout: int.positive(),
    outcome: outcome.nullable(),
    events: z
      .array(
        z
          .object({
            id: int,
            kind: z.enum(["fire", "bounce", "hit", "pickup"]),
            x: int,
            y: int,
          })
          .strict(),
      )
      .max(16384),
  })
  .strict();
export const setupSchema = z
  .object({
    config: z
      .object({
        playerCount: int.min(2).max(8),
        targetScore: int,
        colors: z.array(int.min(0).max(7)).max(8),
      })
      .strict(),
    colors: z.record(z.string(), int.min(0).max(7)),
    players: z
      .array(
        z.object({ slotId: z.string(), color: int.min(0).max(7) }).strict(),
      )
      .max(8),
    participantSlotIds: z.array(z.string()).max(8),
    canEdit: z.boolean(),
    selfSlotId: z.string().nullable(),
  })
  .strict();
export type View = z.infer<typeof viewSchema>;
export type Setup = z.infer<typeof setupSchema>;
