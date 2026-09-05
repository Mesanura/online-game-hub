import { z } from "zod";

export const CHINESE_CHECKERS_CELL_COUNT = 73;
export const CHINESE_CHECKERS_CAMPS = [
  "N",
  "NE",
  "SE",
  "S",
  "SW",
  "NW",
] as const;

const slotIdSchema = z.string().min(1).max(128);
export const chineseCheckersCampSchema = z.enum(CHINESE_CHECKERS_CAMPS);
const cellSchema = z
  .number()
  .int()
  .min(0)
  .max(CHINESE_CHECKERS_CELL_COUNT - 1);
const starterSelectionSchema = z.enum([
  "UNSELECTED",
  "OWNER",
  "NON_OWNER",
  "RANDOM",
  "FIXED",
]);

const setupParticipantSchema = z
  .object({
    slotId: slotIdSchema,
    isOwner: z.boolean(),
    camp: chineseCheckersCampSchema.nullable(),
  })
  .strict();

export const chineseCheckersSetupViewSchema = z
  .object({
    targetPlayerCount: z.number().int().min(2).max(6),
    starter: starterSelectionSchema,
    fixedStarterSlotId: slotIdSchema.nullable(),
    participants: z.array(setupParticipantSchema).max(6),
    canEditRules: z.boolean(),
    canSelectCamp: z.boolean(),
    yourCamp: chineseCheckersCampSchema.nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    if ((view.starter === "FIXED") !== (view.fixedStarterSlotId !== null)) {
      context.addIssue({
        code: "custom",
        message: "FIXED starter must identify one stable slot.",
      });
    }
    const slotIds = view.participants.map((participant) => participant.slotId);
    if (new Set(slotIds).size !== slotIds.length) {
      context.addIssue({ code: "custom", message: "Slots must be unique." });
    }
    const camps = view.participants.flatMap((participant) =>
      participant.camp === null ? [] : [participant.camp],
    );
    if (new Set(camps).size !== camps.length) {
      context.addIssue({ code: "custom", message: "Camps must be unique." });
    }
  });
export type ChineseCheckersSetupView = z.infer<
  typeof chineseCheckersSetupViewSchema
>;

const playerSchema = z
  .object({ slotId: slotIdSchema, camp: chineseCheckersCampSchema })
  .strict();
const legalMoveSchema = z.object({ from: cellSchema, to: cellSchema }).strict();
const rankingSchema = z
  .object({
    slotId: slotIdSchema,
    rank: z.number().int().positive(),
    reason: z.enum(["FINISHED", "RESIGNATION", "BLOCKED", "LAST_REMAINING"]),
  })
  .strict();
const outcomeSchema = z
  .object({ type: z.literal("RANKING"), rankings: z.array(rankingSchema) })
  .strict();

export const chineseCheckersPlayViewSchema = z
  .object({
    players: z.array(playerSchema).min(2).max(6),
    board: z.array(slotIdSchema.nullable()).length(CHINESE_CHECKERS_CELL_COUNT),
    nextTurnSlotId: slotIdSchema.nullable(),
    legalMoves: z.array(legalMoveSchema),
    rankings: z.array(rankingSchema),
    outcome: outcomeSchema.nullable(),
    yourCamp: chineseCheckersCampSchema.nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const slots = view.players.map((player) => player.slotId);
    const camps = view.players.map((player) => player.camp);
    if (
      new Set(slots).size !== slots.length ||
      new Set(camps).size !== camps.length
    ) {
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
    for (const [playerIndex, slotId] of slots.entries()) {
      if (view.board.filter((owner) => owner === slotId).length !== 6) {
        context.addIssue({
          code: "custom",
          message: "Each player must own exactly six pieces.",
          path: ["players", playerIndex],
        });
      }
    }
    if (view.nextTurnSlotId !== null && !slots.includes(view.nextTurnSlotId)) {
      context.addIssue({ code: "custom", message: "Turn slot is invalid." });
    }
    if (view.outcome === null && view.nextTurnSlotId === null) {
      context.addIssue({
        code: "custom",
        message: "Active games must identify the next turn.",
        path: ["nextTurnSlotId"],
      });
    }
    if (view.outcome === null && view.legalMoves.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Active games must expose at least one legal move.",
        path: ["legalMoves"],
      });
    }
    if (view.outcome !== null && view.nextTurnSlotId !== null) {
      context.addIssue({
        code: "custom",
        message: "Completed games have no turn.",
      });
    }
    const moveKeys = view.legalMoves.map((move) => `${move.from}:${move.to}`);
    if (new Set(moveKeys).size !== moveKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Legal moves must be unique.",
      });
    }
    if (
      view.legalMoves.some(
        (move) =>
          view.nextTurnSlotId === null ||
          view.board[move.from] !== view.nextTurnSlotId ||
          view.board[move.to] !== null,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Legal moves must match the projected board and turn.",
      });
    }
    const rankingSlots = view.rankings.map((entry) => entry.slotId);
    const rankingValues = view.rankings.map((entry) => entry.rank);
    if (
      new Set(rankingSlots).size !== rankingSlots.length ||
      rankingSlots.some((slotId) => !slots.includes(slotId)) ||
      new Set(rankingValues).size !== rankingValues.length ||
      rankingValues.some((rank) => rank > view.players.length)
    ) {
      context.addIssue({ code: "custom", message: "Rankings are invalid." });
    }
    if (
      view.outcome !== null &&
      JSON.stringify(view.outcome.rankings) !== JSON.stringify(view.rankings)
    ) {
      context.addIssue({
        code: "custom",
        message: "Outcome rankings must match the projected rankings.",
      });
    }
    if (view.yourCamp !== null && !camps.includes(view.yourCamp)) {
      context.addIssue({
        code: "custom",
        message: "Viewer camp must belong to a projected player.",
        path: ["yourCamp"],
      });
    }
  });
export type ChineseCheckersPlayView = z.infer<
  typeof chineseCheckersPlayViewSchema
>;

export const chineseCheckersSetupIntentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("SELECT_PLAYER_COUNT"),
      playerCount: z.number().int().min(2).max(6),
    })
    .strict(),
  z
    .object({ type: z.literal("SELECT_CAMP"), camp: chineseCheckersCampSchema })
    .strict(),
  z.object({ type: z.literal("CLEAR_CAMP") }).strict(),
  z
    .object({
      type: z.literal("SELECT_STARTER"),
      starter: z.enum(["OWNER", "NON_OWNER", "RANDOM"]),
    })
    .strict(),
]);
export type ChineseCheckersSetupIntent = z.infer<
  typeof chineseCheckersSetupIntentSchema
>;

export const chineseCheckersPlayIntentSchema = z
  .object({ type: z.literal("MOVE_PIECE"), from: cellSchema, to: cellSchema })
  .strict();
export type ChineseCheckersPlayIntent = z.infer<
  typeof chineseCheckersPlayIntentSchema
>;
