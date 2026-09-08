import { z } from "zod";

import { COURT, PHYSICS, scoreLimit } from "../constants.js";

const integer = z.number().int();
const slot = z.string().min(1).max(128);
const side = z.union([z.literal(0), z.literal(1)]);
const targetScore = z.union([z.literal(7), z.literal(11), z.literal(21)]);
const direction = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
const shot = z.enum(["NONE", "CLEAR", "DROP", "SMASH"]);
const scores = z.tuple([integer.min(0).max(30), integer.min(0).max(30)]);

export const badmintonConfigSchema = z.object({ targetScore }).strict();
export const badmintonInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("CONTROL"),
      move: direction,
      jump: z.boolean(),
      serve: z.boolean(),
      shot,
    })
    .strict(),
  z.object({ type: z.literal("RESIGN") }).strict(),
]);
const controls = z
  .object({ move: direction, jump: z.boolean(), serve: z.boolean(), shot })
  .strict();
const contact = z
  .object({
    tick: integer.nonnegative(),
    x: integer,
    y: integer,
    shot: z.enum(["CLEAR", "DROP", "SMASH"]),
  })
  .strict();
const athlete = z
  .object({
    x: integer.min(30_000).max(970_000),
    y: integer.min(250_000).max(COURT.ground),
    velocityY: integer.min(-PHYSICS.jumpSpeed).max(PHYSICS.maxFallSpeed),
    controls,
    inputAge: integer.min(0).max(PHYSICS.inputLease),
    jumpHeld: z.boolean(),
    serveHeld: z.boolean(),
    moving: z.boolean(),
    swingTicks: integer.min(0).max(PHYSICS.serveSwingDuration),
    cooldown: integer.min(0).max(PHYSICS.swingCooldown),
    swingShot: shot,
    hitThisSwing: z.boolean(),
    swingKind: z.enum(["OVERHEAD", "UNDERHAND", "SERVE"]).nullable(),
    swingStartedTick: integer.nonnegative().nullable(),
    lastContact: contact.nullable(),
  })
  .strict();

const point = z
  .object({
    winner: side,
    reason: z.enum(["GROUND", "OUT", "NET"]),
    x: integer,
    y: integer,
  })
  .strict();

export const badmintonOutcomeSchema = z.discriminatedUnion("reason", [
  z
    .object({
      type: z.literal("WIN"),
      reason: z.literal("SCORE"),
      winnerSlotId: slot,
      scores,
    })
    .strict(),
  z
    .object({
      type: z.literal("WIN"),
      reason: z.literal("RESIGNATION"),
      winnerSlotId: slot,
      resignedSlotId: slot,
      scores,
    })
    .strict(),
]);

export const badmintonStateSchema = z
  .object({
    players: z.tuple([slot, slot]),
    targetScore,
    tick: integer.nonnegative(),
    phase: z.enum(["SERVE", "SERVING", "RALLY", "POINT", "FINISHED"]),
    phaseTicks: integer.min(0).max(PHYSICS.pointDelay),
    server: side,
    athletes: z.tuple([athlete, athlete]),
    shuttle: z
      .object({
        x: integer,
        y: integer,
        velocityX: integer.min(-30_000).max(30_000),
        velocityY: integer.min(-30_000).max(PHYSICS.maxFallSpeed),
        lastHit: side.nullable(),
      })
      .strict(),
    scores,
    rally: integer.positive(),
    rallyHits: integer.nonnegative(),
    bestRally: integer.nonnegative(),
    lastPoint: point.nullable(),
    resignedSlotId: slot.nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.players[0] === state.players[1])
      context.addIssue({
        code: "custom",
        message: "Player slots must be distinct.",
      });
    if (
      state.athletes[0].x > COURT.netX - 35_000 ||
      state.athletes[1].x < COURT.netX + 35_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Players must stay on their own side.",
      });
    }
    if (
      state.resignedSlotId !== null &&
      !state.players.includes(state.resignedSlotId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Resigned slot must be a player.",
      });
    }
    if (state.scores.some((value) => value > scoreLimit(state.targetScore))) {
      context.addIssue({
        code: "custom",
        message: "Score exceeds the configured cap.",
      });
    }
  });

export type BadmintonConfig = z.infer<typeof badmintonConfigSchema>;
export type BadmintonInput = z.infer<typeof badmintonInputSchema>;
export type BadmintonState = z.infer<typeof badmintonStateSchema>;
export type BadmintonOutcome = z.infer<typeof badmintonOutcomeSchema>;
export type BadmintonControls = z.infer<typeof controls>;
export type BadmintonSide = 0 | 1;
