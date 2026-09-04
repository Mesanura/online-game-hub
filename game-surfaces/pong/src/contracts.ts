import { z } from "zod";

export const PONG_FIELD_WIDTH = 800_000;
export const PONG_FIELD_HEIGHT = 400_000;
export const PONG_PADDLE_WIDTH = 12_000;
export const PONG_PADDLE_HEIGHT = 80_000;
export const PONG_LEFT_PADDLE_X = 30_000;
export const PONG_RIGHT_PADDLE_X = 770_000;
export const PONG_BALL_RADIUS = 8_000;

const stableSlotIdSchema = z.string().min(1).max(128);
const scoreSchema = z.number().int().min(0).max(9);
const starterSelectionSchema = z.enum([
  "UNSELECTED",
  "OWNER",
  "NON_OWNER",
  "RANDOM",
  "FIXED",
]);

export const pongSetupViewSchema = z
  .object({
    config: z.object({ targetScore: z.number().int().min(1).max(9) }).strict(),
    starter: starterSelectionSchema,
    fixedStarterSlotId: stableSlotIdSchema.nullable(),
    participantSlotIds: z.array(stableSlotIdSchema).max(2),
    canEdit: z.boolean(),
  })
  .strict()
  .superRefine((view, context) => {
    if ((view.starter === "FIXED") !== (view.fixedStarterSlotId !== null)) {
      context.addIssue({
        code: "custom",
        message: "FIXED starter must identify one stable slot.",
      });
    }
    if (
      new Set(view.participantSlotIds).size !== view.participantSlotIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Participant slots must be unique.",
      });
    }
  });
export type PongSetupView = z.infer<typeof pongSetupViewSchema>;

const pongOutcomeSchema = z.union([
  z
    .object({
      type: z.literal("WIN"),
      reason: z.literal("SCORE"),
      winnerSlotId: stableSlotIdSchema,
      scores: z.tuple([scoreSchema, scoreSchema]),
    })
    .strict(),
  z
    .object({
      type: z.literal("WIN"),
      reason: z.literal("RESIGNATION"),
      winnerSlotId: stableSlotIdSchema,
      resignedSlotId: stableSlotIdSchema,
      scores: z.tuple([scoreSchema, scoreSchema]),
    })
    .strict(),
]);

export const pongPlayViewSchema = z
  .object({
    field: z
      .object({
        width: z.literal(PONG_FIELD_WIDTH),
        height: z.literal(PONG_FIELD_HEIGHT),
      })
      .strict(),
    players: z.tuple([
      z
        .object({ slotId: stableSlotIdSchema, side: z.literal("LEFT") })
        .strict(),
      z
        .object({ slotId: stableSlotIdSchema, side: z.literal("RIGHT") })
        .strict(),
    ]),
    paddles: z.tuple([
      z
        .object({
          y: z.number().int(),
          height: z.literal(PONG_PADDLE_HEIGHT),
        })
        .strict(),
      z
        .object({
          y: z.number().int(),
          height: z.literal(PONG_PADDLE_HEIGHT),
        })
        .strict(),
    ]),
    ball: z
      .object({
        x: z.number().int(),
        y: z.number().int(),
        radius: z.literal(PONG_BALL_RADIUS),
      })
      .strict(),
    scores: z.tuple([scoreSchema, scoreSchema]),
    tick: z.number().int().nonnegative(),
    targetScore: z.number().int().min(1).max(9),
    yourSide: z.enum(["LEFT", "RIGHT"]).nullable(),
    outcome: pongOutcomeSchema.nullable(),
  })
  .strict();
export type PongPlayView = z.infer<typeof pongPlayViewSchema>;

export const pongSetupIntentSchema = z
  .object({
    type: z.literal("SELECT_STARTER"),
    starter: z.enum(["OWNER", "NON_OWNER", "RANDOM"]),
  })
  .strict();
export type PongSetupIntent = z.infer<typeof pongSetupIntentSchema>;

export const pongPlayIntentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("DIRECTION"),
      direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    })
    .strict(),
  z.object({ type: z.literal("RESIGN") }).strict(),
]);
export type PongPlayIntent = z.infer<typeof pongPlayIntentSchema>;
