import { z } from "zod";

const integer = z.number().int();
const slot = z.string().min(1).max(128);
const side = z.union([z.literal(0), z.literal(1)]);
export const targetScoreSchema = z.union([
  z.literal(5),
  z.literal(7),
  z.literal(11),
]);
const scores = z.tuple([integer.min(0).max(11), integer.min(0).max(11)]);
const point = z.object({ x: integer, y: integer }).strict();
export const setupIntentSchema = z
  .object({
    type: z.literal("SET_TARGET_SCORE"),
    targetScore: targetScoreSchema,
  })
  .strict();
export const playIntentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("CONTROL"),
      target: z
        .object({ x: integer.min(0).max(10000), y: integer.min(0).max(10000) })
        .strict()
        .nullable(),
    })
    .strict(),
  z.object({ type: z.literal("RESIGN") }).strict(),
]);
export const setupViewSchema = z
  .object({
    config: z.object({ targetScore: targetScoreSchema }).strict(),
    participantSlotIds: z.array(slot).max(2),
    ownerSlotId: slot.nullable(),
    canEdit: z.boolean(),
  })
  .strict();
const outcomeSchema = z.discriminatedUnion("reason", [
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
export const impactSchema = z
  .object({
    id: integer.positive(),
    tick: integer.nonnegative(),
    kind: z.enum(["PADDLE", "WALL", "GOAL"]),
    x: integer,
    y: integer,
    strength: integer.min(0).max(1000),
    side: side.nullable(),
    edge: z.enum(["LEFT", "RIGHT", "TOP", "BOTTOM"]).nullable(),
  })
  .strict();
export const playViewSchema = z
  .object({
    field: z
      .object({
        width: z.literal(600000),
        height: z.literal(1020000),
        paddleRadius: z.literal(42000),
        puckRadius: z.literal(18000),
        centerRadius: z.literal(132000),
        goalLeft: z.literal(216000),
        goalRight: z.literal(384000),
      })
      .strict(),
    players: z.tuple([
      z
        .object({ slotId: slot, side: z.literal(0), color: z.literal("BLUE") })
        .strict(),
      z
        .object({
          slotId: slot,
          side: z.literal(1),
          color: z.literal("ORANGE"),
        })
        .strict(),
    ]),
    yourSide: side,
    paddles: z.tuple([point, point]),
    puck: point,
    scores,
    targetScore: targetScoreSchema,
    phase: z.enum(["SERVE", "RALLY", "FINISHED"]),
    server: side,
    tick: integer.nonnegative(),
    rally: integer.positive(),
    events: z.array(impactSchema).max(64),
    outcome: outcomeSchema.nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    if (view.players[0].slotId === view.players[1].slotId)
      context.addIssue({
        code: "custom",
        message: "Players must be distinct.",
      });
    if ((view.phase === "FINISHED") !== (view.outcome !== null))
      context.addIssue({ code: "custom", message: "Invalid completed state." });
    if (
      view.events.some(
        (event, i) =>
          event.tick >= view.tick ||
          (i > 0 && event.id <= (view.events[i - 1]?.id ?? 0)),
      )
    )
      context.addIssue({ code: "custom", message: "Invalid event ordering." });
  });

export type PlayView = z.infer<typeof playViewSchema>;
export type PlayIntent = z.infer<typeof playIntentSchema>;
export type SetupView = z.infer<typeof setupViewSchema>;
export type SetupIntent = z.infer<typeof setupIntentSchema>;
export type Impact = z.infer<typeof impactSchema>;
export type Side = 0 | 1;
export type Point = { x: number; y: number };

export function parsePlayView(payload: unknown, version: string): PlayView {
  if (version !== "1.0.0" && version !== "1.1.0")
    throw new Error("Unsupported air hockey rules.");
  return playViewSchema.parse(payload);
}
