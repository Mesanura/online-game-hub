import { z } from "zod";

export const CONNECT_FOUR_COLUMNS = 7;
export const CONNECT_FOUR_ROWS = 6;
export const CONNECT_FOUR_CELL_COUNT = 42;

const slotIdSchema = z.string().min(1).max(128);
const starterSelectionSchema = z.enum([
  "UNSELECTED",
  "OWNER",
  "NON_OWNER",
  "RANDOM",
  "FIXED",
]);

export const connectFourSetupViewSchema = z
  .object({
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
export type ConnectFourSetupView = z.infer<typeof connectFourSetupViewSchema>;

const normalWinSchema = z
  .object({
    type: z.literal("WIN"),
    winnerSlotId: slotIdSchema,
    winningCells: z.tuple([
      z.number().int().min(0).max(41),
      z.number().int().min(0).max(41),
      z.number().int().min(0).max(41),
      z.number().int().min(0).max(41),
    ]),
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
export const connectFourOutcomeSchema = z.union([
  normalWinSchema,
  resignationWinSchema,
  z.object({ type: z.literal("DRAW") }).strict(),
]);

export const connectFourPlayViewSchema = z
  .object({
    players: z.tuple([
      z.object({ slotId: slotIdSchema, disc: z.literal("RED") }).strict(),
      z.object({ slotId: slotIdSchema, disc: z.literal("YELLOW") }).strict(),
    ]),
    board: z.array(slotIdSchema.nullable()).length(CONNECT_FOUR_CELL_COUNT),
    nextTurnSlotId: slotIdSchema.nullable(),
    outcome: connectFourOutcomeSchema.nullable(),
    yourDisc: z.enum(["RED", "YELLOW"]).nullable(),
  })
  .strict();
export type ConnectFourPlayView = z.infer<typeof connectFourPlayViewSchema>;

export const connectFourSetupIntentSchema = z
  .object({
    type: z.literal("SELECT_STARTER"),
    starter: z.enum(["OWNER", "NON_OWNER", "RANDOM"]),
  })
  .strict();
export type ConnectFourSetupIntent = z.infer<
  typeof connectFourSetupIntentSchema
>;

export const connectFourPlayIntentSchema = z
  .object({
    type: z.literal("DROP_DISC"),
    column: z.number().int().min(0).max(6),
  })
  .strict();
export type ConnectFourPlayIntent = z.infer<typeof connectFourPlayIntentSchema>;
