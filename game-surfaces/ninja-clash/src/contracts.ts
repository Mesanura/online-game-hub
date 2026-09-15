import { z } from "zod";
const integer = z.number().int();
const direction = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
const facing = z.union([z.literal(-1), z.literal(1)]);
const config = z
  .object({
    playerCount: integer.min(2).max(4),
    targetScore: z.union([
      z.literal(3),
      z.literal(5),
      z.literal(7),
      z.literal(10),
    ]),
  })
  .strict();
const rect = z
  .object({
    x: integer,
    y: integer,
    w: integer.nonnegative(),
    h: integer.nonnegative(),
  })
  .strict();
const outcome = z
  .object({
    type: z.enum(["WIN", "DRAW"]),
    winnerSlotId: z.string().nullable(),
    reason: z.enum(["TARGET_SCORE", "RESIGNATION"]),
    standings: z
      .array(
        z
          .object({
            slotId: z.string(),
            score: integer.nonnegative(),
            resigned: z.boolean(),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict();
export const setupViewSchema = z
  .object({
    config,
    players: z
      .array(
        z.object({ slotId: z.string(), index: integer.min(0).max(3) }).strict(),
      )
      .max(4),
    participantSlotIds: z.array(z.string()).max(4),
    canEdit: z.boolean(),
    selfSlotId: z.string().nullable(),
  })
  .strict();
export const setupIntentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("SET_PLAYER_COUNT"),
      playerCount: config.shape.playerCount,
    })
    .strict(),
  z
    .object({
      type: z.literal("SET_TARGET_SCORE"),
      targetScore: config.shape.targetScore,
    })
    .strict(),
]);
export const playIntentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MOVE"), direction }).strict(),
  ...(["JUMP", "ATTACK", "SLIDE", "RESIGN"] as const).map((type) =>
    z.object({ type: z.literal(type) }).strict(),
  ),
]);
const legacyPlayViewSchema = z
  .object({
    tick: integer.nonnegative(),
    round: integer.positive(),
    phase: z.enum(["COUNTDOWN", "ACTIVE", "FINISHED"]),
    countdown: integer.min(0).max(180),
    targetScore: config.shape.targetScore,
    lastWinner: z.string().nullable(),
    selfSlotId: z.string(),
    arena: z
      .object({
        width: integer.positive(),
        height: integer.positive(),
        platforms: z.array(rect).max(50),
      })
      .strict(),
    players: z
      .array(
        z
          .object({
            slotId: z.string(),
            index: integer.min(0).max(3),
            x: integer,
            y: integer,
            facing,
            grounded: z.boolean(),
            wall: direction,
            alive: z.boolean(),
            resigned: z.boolean(),
            score: integer.nonnegative(),
            motion: z.enum([
              "SLIDE",
              "ATTACK",
              "WALL",
              "RISE",
              "FALL",
              "RUN",
              "IDLE",
            ]),
            invulnerable: z.boolean(),
            attackAge: integer.min(0).max(18),
            attackFacing: facing,
            attackCooldown: integer.nonnegative(),
            slideCooldown: integer.nonnegative(),
            blade: rect.nullable(),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    effects: z
      .array(
        z
          .object({
            id: integer.positive(),
            kind: z.enum(["ATTACK", "CLASH", "DEATH", "SLIDE"]),
            x: integer,
            y: integer,
            until: integer.nonnegative(),
          })
          .strict(),
      )
      .max(128),
    outcome: outcome.nullable(),
  })
  .strict();
export const effectSchema = z
  .object({
    id: integer.positive(),
    kind: z.enum(["ATTACK", "CLASH", "DEATH", "SLIDE", "JUMP", "WALL_JUMP"]),
    x: integer,
    y: integer,
    until: integer.nonnegative(),
    startedAt: integer.nonnegative(),
    sourceSlotId: z.string().nullable(),
    targetSlotId: z.string().nullable(),
    facing,
  })
  .strict();
export const playViewSchema = legacyPlayViewSchema
  .extend({
    animationTick: integer.nonnegative(),
    hitstopTicks: integer.min(0).max(6),
    players: z
      .array(
        legacyPlayViewSchema.shape.players.element.extend({
          motion: z.enum([
            "SLIDE",
            "ATTACK",
            "CLASH",
            "WALL",
            "RISE",
            "FALL",
            "RUN",
            "IDLE",
          ]),
        }),
      )
      .min(2)
      .max(4),
    effects: z.array(effectSchema).max(128),
  })
  .strict();
export function parsePlayView(payload: unknown, version: string): PlayView {
  if (version === "1.1.0") return playViewSchema.parse(payload);
  if (version !== "1.0.0") throw new Error("Unsupported game version");
  const legacy = legacyPlayViewSchema.parse(payload);
  return {
    ...legacy,
    animationTick: legacy.tick,
    hitstopTicks: 0,
    effects: legacy.effects.map((e) => ({
      ...e,
      startedAt: Math.max(0, e.until - 18),
      sourceSlotId: null,
      targetSlotId: null,
      facing: 1 as const,
    })),
  };
}
export type PlayView = z.infer<typeof playViewSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type SetupView = z.infer<typeof setupViewSchema>;
export type PlayIntent = z.infer<typeof playIntentSchema>;
export type SetupIntent = z.infer<typeof setupIntentSchema>;
