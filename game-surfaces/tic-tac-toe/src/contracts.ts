import { z } from "zod";

export const ticTacToeCellIndexSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
]);
export type TicTacToeCellIndex = z.infer<typeof ticTacToeCellIndexSchema>;

const stableSlotIdSchema = z.string().min(1).max(128);
const starterSelectionSchema = z.enum([
  "UNSELECTED",
  "OWNER",
  "NON_OWNER",
  "RANDOM",
  "FIXED",
]);

export const ticTacToeSetupViewSchema = z
  .object({
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
export type TicTacToeSetupView = z.infer<typeof ticTacToeSetupViewSchema>;

const boardSchema = z.array(stableSlotIdSchema.nullable()).length(9);
const boardWinOutcomeSchema = z
  .object({
    type: z.literal("WIN"),
    winnerSlotId: stableSlotIdSchema,
    winningCells: z.tuple([
      ticTacToeCellIndexSchema,
      ticTacToeCellIndexSchema,
      ticTacToeCellIndexSchema,
    ]),
  })
  .strict();
const resignationOutcomeSchema = z
  .object({
    type: z.literal("WIN"),
    reason: z.literal("RESIGNATION"),
    winnerSlotId: stableSlotIdSchema,
    resignedSlotId: stableSlotIdSchema,
  })
  .strict();
const drawOutcomeSchema = z.object({ type: z.literal("DRAW") }).strict();
const historicalOutcomeSchema = z.union([
  boardWinOutcomeSchema,
  drawOutcomeSchema,
]);
const currentOutcomeSchema = z.union([
  boardWinOutcomeSchema,
  resignationOutcomeSchema,
  drawOutcomeSchema,
]);

const playViewShape = {
  players: z.tuple([
    z.object({ slotId: stableSlotIdSchema, mark: z.literal("X") }).strict(),
    z.object({ slotId: stableSlotIdSchema, mark: z.literal("O") }).strict(),
  ]),
  board: boardSchema,
  nextTurnSlotId: stableSlotIdSchema.nullable(),
  yourMark: z.enum(["X", "O"]).nullable(),
} as const;

export const ticTacToeHistoricalPlayViewSchema = z
  .object({
    ...playViewShape,
    outcome: historicalOutcomeSchema.nullable(),
  })
  .strict();

export const ticTacToePlayViewSchema = z
  .object({
    ...playViewShape,
    outcome: currentOutcomeSchema.nullable(),
  })
  .strict();
export type TicTacToePlayView = z.infer<typeof ticTacToePlayViewSchema>;

export const ticTacToeSetupIntentSchema = z
  .object({
    type: z.literal("SELECT_STARTER"),
    starter: z.enum(["OWNER", "NON_OWNER", "RANDOM"]),
  })
  .strict();
export type TicTacToeSetupIntent = z.infer<typeof ticTacToeSetupIntentSchema>;

export const ticTacToePlayIntentSchema = z
  .object({
    type: z.literal("PLACE_MARK"),
    cell: ticTacToeCellIndexSchema,
  })
  .strict();
export type TicTacToePlayIntent = z.infer<typeof ticTacToePlayIntentSchema>;
