import { z } from "zod";

const slotIdSchema = z.string().min(1).max(128);
const configSchema = z
  .object({
    boardSize: z.union([z.literal(15), z.literal(19)]),
    winLength: z.literal(5),
  })
  .strict();
const starterSelectionSchema = z.enum([
  "UNSELECTED",
  "OWNER",
  "NON_OWNER",
  "RANDOM",
  "FIXED",
]);

export const gomokuSetupViewSchema = z
  .object({
    config: configSchema,
    starter: starterSelectionSchema,
    fixedStarterSlotId: slotIdSchema.nullable(),
    participantSlotIds: z.array(slotIdSchema).max(2),
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
      context.addIssue({ code: "custom", message: "Slots must be unique." });
    }
  });
export type GomokuSetupView = z.infer<typeof gomokuSetupViewSchema>;

const normalWinSchema = z
  .object({
    type: z.literal("WIN"),
    winnerSlotId: slotIdSchema,
    winningCells: z.array(z.number().int().nonnegative()).length(5),
  })
  .strict();
const resignationWinSchema = z
  .object({
    type: z.literal("WIN"),
    reason: z.literal("RESIGNATION"),
    winnerSlotId: slotIdSchema,
    resignedSlotId: slotIdSchema,
  })
  .strict();
export const gomokuOutcomeSchema = z.union([
  normalWinSchema,
  resignationWinSchema,
  z.object({ type: z.literal("DRAW") }).strict(),
]);

export const gomokuPlayViewSchema = z
  .object({
    boardSize: z.union([z.literal(15), z.literal(19)]),
    winLength: z.literal(5),
    players: z.tuple([
      z.object({ slotId: slotIdSchema, stone: z.literal("BLACK") }).strict(),
      z.object({ slotId: slotIdSchema, stone: z.literal("WHITE") }).strict(),
    ]),
    board: z.array(slotIdSchema.nullable()),
    nextTurnSlotId: slotIdSchema.nullable(),
    outcome: gomokuOutcomeSchema.nullable(),
    yourStone: z.enum(["BLACK", "WHITE"]).nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    if (view.board.length !== view.boardSize * view.boardSize) {
      context.addIssue({ code: "custom", message: "Board size mismatch." });
    }
    if (
      view.outcome !== null &&
      "winningCells" in view.outcome &&
      view.outcome.winningCells.some((cell) => cell >= view.board.length)
    ) {
      context.addIssue({ code: "custom", message: "Winning cell is invalid." });
    }
  });
export type GomokuPlayView = z.infer<typeof gomokuPlayViewSchema>;

export const gomokuSetupIntentSchema = z
  .object({
    type: z.literal("SELECT_STARTER"),
    starter: z.enum(["OWNER", "NON_OWNER", "RANDOM"]),
  })
  .strict();
export type GomokuSetupIntent = z.infer<typeof gomokuSetupIntentSchema>;

export const gomokuPlayIntentSchema = z
  .object({
    type: z.literal("PLACE_STONE"),
    cell: z.number().int().nonnegative(),
  })
  .strict();
export type GomokuPlayIntent = z.infer<typeof gomokuPlayIntentSchema>;
