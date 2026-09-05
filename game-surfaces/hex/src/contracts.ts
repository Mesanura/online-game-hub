import { z } from "zod";

export const HEX_BOARD_SIZE = 11;
export const HEX_CELL_COUNT = HEX_BOARD_SIZE * HEX_BOARD_SIZE;

const slotIdSchema = z.string().min(1).max(128);
const cellSchema = z
  .number()
  .int()
  .min(0)
  .max(HEX_CELL_COUNT - 1);
const starterSelectionSchema = z.enum([
  "UNSELECTED",
  "OWNER",
  "NON_OWNER",
  "RANDOM",
  "FIXED",
]);

export const hexSetupViewSchema = z
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
    if (
      view.fixedStarterSlotId !== null &&
      !view.participantSlotIds.includes(view.fixedStarterSlotId)
    ) {
      context.addIssue({
        code: "custom",
        message: "The fixed starter must be a visible participant.",
      });
    }
  });
export type HexSetupView = z.infer<typeof hexSetupViewSchema>;

const connectionWinSchema = z
  .object({
    type: z.literal("WIN"),
    reason: z.literal("CONNECTION"),
    winnerSlotId: slotIdSchema,
    winningPath: z.array(cellSchema).min(HEX_BOARD_SIZE).max(HEX_CELL_COUNT),
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
export const hexOutcomeSchema = z.discriminatedUnion("reason", [
  connectionWinSchema,
  resignationWinSchema,
]);

function cellsShareSide(firstCell: number, secondCell: number): boolean {
  const firstRow = Math.floor(firstCell / HEX_BOARD_SIZE);
  const firstColumn = firstCell % HEX_BOARD_SIZE;
  const secondRow = Math.floor(secondCell / HEX_BOARD_SIZE);
  const secondColumn = secondCell % HEX_BOARD_SIZE;
  return [
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
  ].some(
    ([rowDelta, columnDelta]) =>
      secondRow - firstRow === rowDelta &&
      secondColumn - firstColumn === columnDelta,
  );
}

export const hexPlayViewSchema = z
  .object({
    players: z.tuple([
      z.object({ slotId: slotIdSchema, color: z.literal("BLUE") }).strict(),
      z.object({ slotId: slotIdSchema, color: z.literal("RED") }).strict(),
    ]),
    board: z.array(slotIdSchema.nullable()).length(HEX_CELL_COUNT),
    nextTurnSlotId: slotIdSchema.nullable(),
    outcome: hexOutcomeSchema.nullable(),
    yourColor: z.enum(["BLUE", "RED"]).nullable(),
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
    if (
      (view.outcome === null && view.nextTurnSlotId === null) ||
      (view.outcome !== null && view.nextTurnSlotId !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Lifecycle fields mismatch.",
      });
    }
    if (view.outcome !== null && !slots.includes(view.outcome.winnerSlotId)) {
      context.addIssue({ code: "custom", message: "Winner is invalid." });
    }
    if (
      view.outcome?.reason === "RESIGNATION" &&
      (!slots.includes(view.outcome.resignedSlotId) ||
        view.outcome.resignedSlotId === view.outcome.winnerSlotId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Resignation players are invalid.",
      });
    }
    if (view.outcome?.reason === "CONNECTION") {
      const path = view.outcome.winningPath;
      const winnerIndex = slots.indexOf(view.outcome.winnerSlotId);
      const start = path[0];
      const end = path.at(-1);
      const connectsRequiredEdges =
        start !== undefined &&
        end !== undefined &&
        (winnerIndex === 0
          ? Math.floor(start / HEX_BOARD_SIZE) === 0 &&
            Math.floor(end / HEX_BOARD_SIZE) === HEX_BOARD_SIZE - 1
          : start % HEX_BOARD_SIZE === 0 &&
            end % HEX_BOARD_SIZE === HEX_BOARD_SIZE - 1);
      if (
        winnerIndex < 0 ||
        new Set(path).size !== path.length ||
        path.some((cell) => view.board[cell] !== view.outcome?.winnerSlotId) ||
        path.slice(1).some((cell, index) => {
          const previous = path[index];
          return previous === undefined || !cellsShareSide(previous, cell);
        }) ||
        !connectsRequiredEdges
      ) {
        context.addIssue({
          code: "custom",
          message: "Winning path is inconsistent with the projected board.",
        });
      }
    }
  });
export type HexPlayView = z.infer<typeof hexPlayViewSchema>;

export const hexSetupIntentSchema = z
  .object({
    type: z.literal("SELECT_STARTER"),
    starter: z.enum(["OWNER", "NON_OWNER", "RANDOM"]),
  })
  .strict();
export type HexSetupIntent = z.infer<typeof hexSetupIntentSchema>;

export const hexPlayIntentSchema = z.union([
  z.object({ type: z.literal("PLACE_STONE"), cell: cellSchema }).strict(),
  z.object({ type: z.literal("RESIGN") }).strict(),
]);
export type HexPlayIntent = z.infer<typeof hexPlayIntentSchema>;
