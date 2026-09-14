import { z } from "zod";

import { COURT, PHYSICS } from "./constants.js";

const integer = z.number().int();
const slot = z.string().min(1).max(128);
export const sideSchema = z.union([z.literal(0), z.literal(1)]);
export const targetScoreSchema = z.union([
  z.literal(5),
  z.literal(7),
  z.literal(11),
]);
const point = z.object({ x: integer, y: integer }).strict();
const pointer = z
  .object({
    x: integer.min(0).max(PHYSICS.pointerScale),
    y: integer.min(0).max(PHYSICS.pointerScale),
  })
  .strict();
const scores = z.tuple([integer.min(0).max(11), integer.min(0).max(11)]);

export const airHockeyConfigSchema = z
  .object({ targetScore: targetScoreSchema })
  .strict();
export const airHockeyInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CONTROL"), target: pointer.nullable() }).strict(),
  z.object({ type: z.literal("RESIGN") }).strict(),
]);
export const airHockeyOutcomeSchema = z.discriminatedUnion("reason", [
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
const impact = z
  .object({
    id: integer.positive(),
    tick: integer.nonnegative(),
    kind: z.enum(["PADDLE", "WALL", "GOAL"]),
    x: integer,
    y: integer,
    strength: integer.min(0).max(1000),
    side: sideSchema.nullable(),
    edge: z.enum(["LEFT", "RIGHT", "TOP", "BOTTOM"]).nullable(),
  })
  .strict();
const paddle = z
  .object({
    x: integer.min(COURT.paddleRadius).max(COURT.width - COURT.paddleRadius),
    y: integer.min(COURT.paddleRadius).max(COURT.height - COURT.paddleRadius),
    target: point.nullable(),
    inputAge: integer.min(0).max(PHYSICS.inputLease),
  })
  .strict();
export const airHockeyStateSchema = z
  .object({
    players: z.tuple([slot, slot]),
    targetScore: targetScoreSchema,
    tick: integer.nonnegative(),
    phase: z.enum(["SERVE", "RALLY", "FINISHED"]),
    server: sideSchema,
    rally: integer.positive(),
    paddles: z.tuple([paddle, paddle]),
    puck: z
      .object({
        x: integer.min(COURT.puckRadius).max(COURT.width - COURT.puckRadius),
        y: integer.min(-COURT.puckRadius).max(COURT.height + COURT.puckRadius),
        velocityX: integer.min(-PHYSICS.puckSpeed).max(PHYSICS.puckSpeed),
        velocityY: integer.min(-PHYSICS.puckSpeed).max(PHYSICS.puckSpeed),
      })
      .strict(),
    scores,
    eventSequence: integer.nonnegative(),
    events: z.array(impact).max(PHYSICS.maxEvents),
    outcome: airHockeyOutcomeSchema.nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (state.players[0] === state.players[1])
      issue("Player slots must be distinct.");
    if (
      state.paddles[0].y < COURT.height / 2 + COURT.paddleRadius ||
      state.paddles[1].y > COURT.height / 2 - COURT.paddleRadius
    )
      issue("Paddles must stay in their own half.");
    if (state.scores.some((score) => score > state.targetScore))
      issue("Score exceeds the target.");
    if ((state.phase === "FINISHED") !== (state.outcome !== null))
      issue("Terminal phase and outcome must agree.");
    if (
      state.outcome !== null &&
      (!state.players.includes(state.outcome.winnerSlotId) ||
        state.outcome.scores.some((score, i) => score !== state.scores[i]))
    )
      issue("Outcome must match this game.");
    if (
      state.phase === "SERVE" &&
      (state.puck.x !== COURT.width / 2 ||
        state.puck.y !== COURT.height / 2 ||
        state.puck.velocityX !== 0 ||
        state.puck.velocityY !== 0)
    )
      issue("A waiting puck must be stationary at center.");
  });

export type AirHockeyConfig = z.infer<typeof airHockeyConfigSchema>;
export type AirHockeyInput = z.infer<typeof airHockeyInputSchema>;
export type AirHockeyOutcome = z.infer<typeof airHockeyOutcomeSchema>;
export type AirHockeyState = z.infer<typeof airHockeyStateSchema>;
export type AirHockeyImpact = z.infer<typeof impact>;
export type Side = z.infer<typeof sideSchema>;
