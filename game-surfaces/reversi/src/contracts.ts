import { z } from "zod";

const slotIdSchema = z.string().min(1).max(128);
const cellSchema = z.number().int().min(0).max(63);
const starterSelectionSchema = z.enum([
  "UNSELECTED",
  "OWNER",
  "NON_OWNER",
  "RANDOM",
  "FIXED",
]);

export const reversiSetupViewSchema = z
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
export type ReversiSetupView = z.infer<typeof reversiSetupViewSchema>;

const discCountsSchema = z
  .object({
    BLACK: z.number().int().min(0).max(64),
    WHITE: z.number().int().min(0).max(64),
  })
  .strict();
const normalWinSchema = z
  .object({
    type: z.literal("WIN"),
    winnerSlotId: slotIdSchema,
    discCounts: discCountsSchema,
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
export const reversiOutcomeSchema = z.union([
  normalWinSchema,
  resignationWinSchema,
  z.object({ type: z.literal("DRAW"), discCounts: discCountsSchema }).strict(),
]);

export const reversiPlayViewSchema = z
  .object({
    players: z.tuple([
      z.object({ slotId: slotIdSchema, disc: z.literal("BLACK") }).strict(),
      z.object({ slotId: slotIdSchema, disc: z.literal("WHITE") }).strict(),
    ]),
    board: z.array(slotIdSchema.nullable()).length(64),
    nextTurnSlotId: slotIdSchema.nullable(),
    legalMoves: z.array(cellSchema),
    discCounts: discCountsSchema,
    outcome: reversiOutcomeSchema.nullable(),
    yourDisc: z.enum(["BLACK", "WHITE"]).nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const slots = view.players.map((player) => player.slotId);
    if (slots[0] === slots[1]) {
      context.addIssue({ code: "custom", message: "Players must be unique." });
    }
    for (const [cell, owner] of view.board.entries()) {
      if (owner !== null && !slots.includes(owner)) {
        context.addIssue({
          code: "custom",
          message: "Board references an unknown player.",
          path: ["board", cell],
        });
      }
    }
    if (view.nextTurnSlotId !== null && !slots.includes(view.nextTurnSlotId)) {
      context.addIssue({ code: "custom", message: "Turn slot is invalid." });
    }
    if (new Set(view.legalMoves).size !== view.legalMoves.length) {
      context.addIssue({
        code: "custom",
        message: "Legal moves must be unique.",
      });
    }
    for (const cell of view.legalMoves) {
      if (view.board[cell] !== null) {
        context.addIssue({
          code: "custom",
          message: "Legal moves must reference empty cells.",
        });
      }
    }
    const blackCount = view.board.filter((owner) => owner === slots[0]).length;
    const whiteCount = view.board.filter((owner) => owner === slots[1]).length;
    if (
      blackCount !== view.discCounts.BLACK ||
      whiteCount !== view.discCounts.WHITE
    ) {
      context.addIssue({ code: "custom", message: "Disc counts mismatch." });
    }
    if (
      (view.outcome === null &&
        (view.nextTurnSlotId === null || view.legalMoves.length === 0)) ||
      (view.outcome !== null &&
        (view.nextTurnSlotId !== null || view.legalMoves.length !== 0))
    ) {
      context.addIssue({
        code: "custom",
        message: "Lifecycle fields mismatch.",
      });
    }
    if (
      view.outcome !== null &&
      "discCounts" in view.outcome &&
      (view.outcome.discCounts.BLACK !== view.discCounts.BLACK ||
        view.outcome.discCounts.WHITE !== view.discCounts.WHITE)
    ) {
      context.addIssue({ code: "custom", message: "Outcome counts mismatch." });
    }
    if (
      view.outcome?.type === "WIN" &&
      "reason" in view.outcome &&
      (!slots.includes(view.outcome.winnerSlotId) ||
        !slots.includes(view.outcome.resignedSlotId) ||
        view.outcome.winnerSlotId === view.outcome.resignedSlotId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Resignation players are invalid.",
      });
    }
    if (
      view.outcome?.type === "DRAW" &&
      view.discCounts.BLACK !== view.discCounts.WHITE
    ) {
      context.addIssue({ code: "custom", message: "Draw counts must match." });
    }
    if (
      view.outcome?.type === "WIN" &&
      "discCounts" in view.outcome &&
      !(
        (view.outcome.winnerSlotId === slots[0] && blackCount > whiteCount) ||
        (view.outcome.winnerSlotId === slots[1] && whiteCount > blackCount)
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Winner must own more visible discs.",
      });
    }
  });
export type ReversiPlayView = z.infer<typeof reversiPlayViewSchema>;

export const reversiSetupIntentSchema = z
  .object({
    type: z.literal("SELECT_STARTER"),
    starter: z.enum(["OWNER", "NON_OWNER", "RANDOM"]),
  })
  .strict();
export type ReversiSetupIntent = z.infer<typeof reversiSetupIntentSchema>;

export const reversiHistoricalPlayIntentSchema = z
  .object({ type: z.literal("PLACE_DISC"), cell: cellSchema })
  .strict();
export const reversiPlayIntentSchema = z.union([
  reversiHistoricalPlayIntentSchema,
  z.object({ type: z.literal("RESIGN") }).strict(),
]);
export type ReversiPlayIntent = z.infer<typeof reversiPlayIntentSchema>;
