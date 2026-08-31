import type {
  DeepReadonly,
  GameDefinition,
  InitialContext,
  Initialized,
  PlayerSlotId,
  Transition,
  TransitionContext,
  ViewContext,
} from "@online-game-hub/game-sdk";
import { z } from "zod";

import { REVERSI_BOARD_SIZE, REVERSI_CELL_COUNT } from "../constants.js";
import { reversiManifest } from "../manifest.js";
import type {
  ReversiAction,
  ReversiBoard,
  ReversiConfig,
  ReversiDiscCounts,
  ReversiOutcome,
  ReversiRuleErrorCode,
  ReversiState,
  ReversiView,
} from "../types.js";

export type {
  ReversiAction,
  ReversiBoard,
  ReversiConfig,
  ReversiDisc,
  ReversiDiscCounts,
  ReversiOutcome,
  ReversiRuleErrorCode,
  ReversiState,
  ReversiView,
} from "../types.js";
export { REVERSI_BOARD_SIZE, REVERSI_CELL_COUNT } from "../constants.js";

const slotIdSchema = z.string().min(1);
const cellIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(REVERSI_CELL_COUNT - 1);
const discCountsSchema = z
  .object({
    BLACK: z.number().int().min(0).max(REVERSI_CELL_COUNT),
    WHITE: z.number().int().min(0).max(REVERSI_CELL_COUNT),
  })
  .strict()
  .superRefine((counts, context) => {
    if (counts.BLACK + counts.WHITE > REVERSI_CELL_COUNT) {
      context.addIssue({
        code: "custom",
        message: "Reversi disc counts may not exceed the board size.",
      });
    }
  });

export const reversiConfigSchema = z.null();

export const reversiActionSchema = z
  .object({
    type: z.literal("PLACE_DISC"),
    cell: cellIndexSchema,
  })
  .strict();

export const reversiOutcomeSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("WIN"),
        winnerSlotId: slotIdSchema,
        discCounts: discCountsSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("DRAW"),
        discCounts: discCountsSchema,
      })
      .strict(),
  ])
  .superRefine((outcome, context) => {
    const tied = outcome.discCounts.BLACK === outcome.discCounts.WHITE;
    if ((outcome.type === "DRAW") !== tied) {
      context.addIssue({
        code: "custom",
        message: "A Reversi draw must have equal disc counts.",
        path: ["discCounts"],
      });
    }
  });

const boardSchema = z.array(slotIdSchema.nullable()).length(REVERSI_CELL_COUNT);

export const reversiStateSchema = z
  .object({
    players: z.tuple([slotIdSchema, slotIdSchema]),
    board: boardSchema,
    nextPlayerIndex: z.union([z.literal(0), z.literal(1)]),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.players[0] === state.players[1]) {
      context.addIssue({
        code: "custom",
        message: "Reversi player slots must be distinct.",
        path: ["players"],
      });
    }
    for (const [cell, owner] of state.board.entries()) {
      if (owner !== null && !state.players.includes(owner)) {
        context.addIssue({
          code: "custom",
          message: "Board cells may only reference registered player slots.",
          path: ["board", cell],
        });
      }
    }
  });

export const reversiViewSchema = z
  .object({
    players: z.tuple([
      z.object({ slotId: slotIdSchema, disc: z.literal("BLACK") }).strict(),
      z.object({ slotId: slotIdSchema, disc: z.literal("WHITE") }).strict(),
    ]),
    board: boardSchema,
    nextTurnSlotId: slotIdSchema.nullable(),
    legalMoves: z.array(cellIndexSchema),
    discCounts: discCountsSchema,
    outcome: reversiOutcomeSchema.nullable(),
    yourDisc: z.enum(["BLACK", "WHITE"]).nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const slots = view.players.map((player) => player.slotId);
    if (slots[0] === slots[1]) {
      context.addIssue({
        code: "custom",
        message: "Reversi view player slots must be distinct.",
        path: ["players"],
      });
    }
    for (const [cell, owner] of view.board.entries()) {
      if (owner !== null && !slots.includes(owner)) {
        context.addIssue({
          code: "custom",
          message: "View board cells may only reference visible player slots.",
          path: ["board", cell],
        });
      }
    }
    if (view.nextTurnSlotId !== null && !slots.includes(view.nextTurnSlotId)) {
      context.addIssue({
        code: "custom",
        message: "The next turn must reference a visible player slot.",
        path: ["nextTurnSlotId"],
      });
    }
    if (new Set(view.legalMoves).size !== view.legalMoves.length) {
      context.addIssue({
        code: "custom",
        message: "Legal moves must be unique.",
        path: ["legalMoves"],
      });
    }
    for (const [index, cell] of view.legalMoves.entries()) {
      if (view.board[cell] !== null) {
        context.addIssue({
          code: "custom",
          message: "A legal move must reference an empty cell.",
          path: ["legalMoves", index],
        });
      }
    }
    const blackCount = view.board.filter((owner) => owner === slots[0]).length;
    const whiteCount = view.board.filter((owner) => owner === slots[1]).length;
    if (
      view.discCounts.BLACK !== blackCount ||
      view.discCounts.WHITE !== whiteCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Visible disc counts must match the board.",
        path: ["discCounts"],
      });
    }
    if (view.outcome === null) {
      if (view.nextTurnSlotId === null || view.legalMoves.length === 0) {
        context.addIssue({
          code: "custom",
          message: "An active Reversi view must expose a turn and legal moves.",
        });
      }
      return;
    }
    if (view.nextTurnSlotId !== null || view.legalMoves.length !== 0) {
      context.addIssue({
        code: "custom",
        message: "A terminal Reversi view may not expose another move.",
      });
    }
    if (
      view.outcome.discCounts.BLACK !== view.discCounts.BLACK ||
      view.outcome.discCounts.WHITE !== view.discCounts.WHITE
    ) {
      context.addIssue({
        code: "custom",
        message: "Outcome counts must match the visible counts.",
        path: ["outcome", "discCounts"],
      });
    }
    if (view.outcome.type === "WIN") {
      const winnerIndex = slots.indexOf(view.outcome.winnerSlotId);
      const winnerHasMore =
        winnerIndex === 0
          ? blackCount > whiteCount
          : winnerIndex === 1
            ? whiteCount > blackCount
            : false;
      if (!winnerHasMore) {
        context.addIssue({
          code: "custom",
          message: "The winner must be the visible player with more discs.",
          path: ["outcome", "winnerSlotId"],
        });
      }
    }
  });

const directions = Object.freeze([
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const);

function rowOf(cell: number): number {
  return Math.floor(cell / REVERSI_BOARD_SIZE);
}

function columnOf(cell: number): number {
  return cell % REVERSI_BOARD_SIZE;
}

function flipsForCell(
  board: DeepReadonly<ReversiBoard>,
  players: readonly [PlayerSlotId, PlayerSlotId],
  playerIndex: 0 | 1,
  cell: number,
): readonly number[] {
  if (
    !Number.isInteger(cell) ||
    cell < 0 ||
    cell >= REVERSI_CELL_COUNT ||
    board[cell] !== null
  ) {
    return [];
  }
  const owner = players[playerIndex];
  const opponent = players[playerIndex === 0 ? 1 : 0];
  const row = rowOf(cell);
  const column = columnOf(cell);
  const flips: number[] = [];

  for (const [rowStep, columnStep] of directions) {
    const line: number[] = [];
    let candidateRow = row + rowStep;
    let candidateColumn = column + columnStep;
    while (
      candidateRow >= 0 &&
      candidateRow < REVERSI_BOARD_SIZE &&
      candidateColumn >= 0 &&
      candidateColumn < REVERSI_BOARD_SIZE &&
      board[candidateRow * REVERSI_BOARD_SIZE + candidateColumn] === opponent
    ) {
      line.push(candidateRow * REVERSI_BOARD_SIZE + candidateColumn);
      candidateRow += rowStep;
      candidateColumn += columnStep;
    }
    if (
      line.length > 0 &&
      candidateRow >= 0 &&
      candidateRow < REVERSI_BOARD_SIZE &&
      candidateColumn >= 0 &&
      candidateColumn < REVERSI_BOARD_SIZE &&
      board[candidateRow * REVERSI_BOARD_SIZE + candidateColumn] === owner
    ) {
      flips.push(...line);
    }
  }
  return flips;
}

function legalMovesFor(
  board: DeepReadonly<ReversiBoard>,
  players: readonly [PlayerSlotId, PlayerSlotId],
  playerIndex: 0 | 1,
): readonly number[] {
  const moves: number[] = [];
  for (let cell = 0; cell < REVERSI_CELL_COUNT; cell += 1) {
    if (flipsForCell(board, players, playerIndex, cell).length > 0) {
      moves.push(cell);
    }
  }
  return moves;
}

function discCounts(state: DeepReadonly<ReversiState>): ReversiDiscCounts {
  return Object.freeze({
    BLACK: state.board.filter((owner) => owner === state.players[0]).length,
    WHITE: state.board.filter((owner) => owner === state.players[1]).length,
  });
}

function freezeOutcome(outcome: ReversiOutcome): ReversiOutcome {
  const counts = Object.freeze({ ...outcome.discCounts });
  return outcome.type === "WIN"
    ? Object.freeze({
        type: "WIN",
        winnerSlotId: outcome.winnerSlotId,
        discCounts: counts,
      })
    : Object.freeze({ type: "DRAW", discCounts: counts });
}

function parseOutcome(input: unknown): ReversiOutcome {
  return freezeOutcome(
    reversiOutcomeSchema.parse(input) as unknown as ReversiOutcome,
  );
}

function parseState(input: unknown): ReversiState {
  const parsed = reversiStateSchema.parse(input);
  return Object.freeze({
    players: Object.freeze([...parsed.players]) as readonly [
      PlayerSlotId,
      PlayerSlotId,
    ],
    board: Object.freeze([...parsed.board]) as ReversiBoard,
    nextPlayerIndex: parsed.nextPlayerIndex,
  });
}

function requirePlayers(
  players: readonly PlayerSlotId[],
): readonly [PlayerSlotId, PlayerSlotId] {
  const first = players[0];
  const second = players[1];
  if (
    players.length !== 2 ||
    first === undefined ||
    second === undefined ||
    first === second
  ) {
    throw new Error("Reversi requires exactly two distinct player slots.");
  }
  return Object.freeze([first, second]);
}

function calculateOutcome(
  state: DeepReadonly<ReversiState>,
): ReversiOutcome | null {
  const blackMoves = legalMovesFor(state.board, state.players, 0);
  const whiteMoves = legalMovesFor(state.board, state.players, 1);
  const boardFull = state.board.every((owner) => owner !== null);
  if (!boardFull && (blackMoves.length > 0 || whiteMoves.length > 0)) {
    const currentMoves = state.nextPlayerIndex === 0 ? blackMoves : whiteMoves;
    if (currentMoves.length === 0) {
      throw new Error(
        "Reversi invariant violated: next player has no legal action.",
      );
    }
    return null;
  }

  const counts = discCounts(state);
  if (counts.BLACK === counts.WHITE) {
    return parseOutcome({ type: "DRAW", discCounts: counts });
  }
  return parseOutcome({
    type: "WIN",
    winnerSlotId:
      counts.BLACK > counts.WHITE ? state.players[0] : state.players[1],
    discCounts: counts,
  });
}

export function createInitialState(
  context: InitialContext<ReversiConfig>,
): Initialized<ReversiState> {
  reversiConfigSchema.parse(context.config);
  const players = requirePlayers(context.players);
  const board = Array<PlayerSlotId | null>(REVERSI_CELL_COUNT).fill(null);
  board[27] = players[1];
  board[36] = players[1];
  board[28] = players[0];
  board[35] = players[0];
  return {
    state: parseState({ players, board, nextPlayerIndex: 0 }),
    rng: context.rng,
  };
}

export function getOutcome(
  state: DeepReadonly<ReversiState>,
): ReversiOutcome | null {
  return calculateOutcome(parseState(state));
}

function reject(code: ReversiRuleErrorCode): Transition<ReversiState> {
  return { status: "rejected", code };
}

export function transition(
  context: TransitionContext<ReversiState, ReversiAction>,
): Transition<ReversiState> {
  const state = parseState(context.state);
  if (calculateOutcome(state) !== null) {
    return reject("MATCH_ALREADY_FINISHED");
  }
  const [blackPlayer, whitePlayer] = state.players;
  if (
    context.actorSlotId !== blackPlayer &&
    context.actorSlotId !== whitePlayer
  ) {
    return reject("NOT_A_PLAYER");
  }
  if (context.actorSlotId !== state.players[state.nextPlayerIndex]) {
    return reject("NOT_YOUR_TURN");
  }
  const cell = context.action.cell;
  if (!Number.isInteger(cell) || cell < 0 || cell >= REVERSI_CELL_COUNT) {
    return reject("CELL_OUT_OF_BOUNDS");
  }
  if (state.board[cell] !== null) {
    return reject("CELL_OCCUPIED");
  }
  const flips = flipsForCell(
    state.board,
    state.players,
    state.nextPlayerIndex,
    cell,
  );
  if (flips.length === 0) {
    return reject("NO_DISC_CAPTURED");
  }

  const board = [...state.board];
  board[cell] = context.actorSlotId;
  for (const flippedCell of flips) board[flippedCell] = context.actorSlotId;

  const actorIndex = state.nextPlayerIndex;
  const opponentIndex = actorIndex === 0 ? 1 : 0;
  const opponentMoves = legalMovesFor(board, state.players, opponentIndex);
  const actorMoves = legalMovesFor(board, state.players, actorIndex);
  const nextPlayerIndex =
    opponentMoves.length > 0
      ? opponentIndex
      : actorMoves.length > 0
        ? actorIndex
        : actorIndex;

  return {
    status: "accepted",
    state: parseState({ players: state.players, board, nextPlayerIndex }),
    rng: context.rng,
  };
}

function freezeView(view: ReversiView): ReversiView {
  return Object.freeze({
    players: Object.freeze(
      view.players.map((player) => Object.freeze({ ...player })),
    ) as ReversiView["players"],
    board: Object.freeze([...view.board]) as ReversiBoard,
    nextTurnSlotId: view.nextTurnSlotId,
    legalMoves: Object.freeze([...view.legalMoves]),
    discCounts: Object.freeze({ ...view.discCounts }),
    outcome: view.outcome === null ? null : freezeOutcome(view.outcome),
    yourDisc: view.yourDisc,
  });
}

export function projectView(context: ViewContext<ReversiState>): ReversiView {
  const state = parseState(context.state);
  const outcome = calculateOutcome(state);
  const [blackPlayer, whitePlayer] = state.players;
  const legalMoves =
    outcome === null
      ? legalMovesFor(state.board, state.players, state.nextPlayerIndex)
      : [];
  const parsed = reversiViewSchema.parse({
    players: [
      { slotId: blackPlayer, disc: "BLACK" },
      { slotId: whitePlayer, disc: "WHITE" },
    ],
    board: state.board,
    nextTurnSlotId:
      outcome === null ? state.players[state.nextPlayerIndex] : null,
    legalMoves,
    discCounts: discCounts(state),
    outcome,
    yourDisc:
      context.viewer.kind === "player"
        ? context.viewer.slotId === blackPlayer
          ? "BLACK"
          : context.viewer.slotId === whitePlayer
            ? "WHITE"
            : null
        : null,
  }) as unknown as ReversiView;
  return freezeView(parsed);
}

export const reversiDefinition = {
  manifest: reversiManifest,
  configSchema: reversiConfigSchema,
  actionSchema: reversiActionSchema,
  createInitialState,
  transition,
  projectView,
  getOutcome,
} satisfies GameDefinition<
  ReversiConfig,
  ReversiState,
  ReversiAction,
  ReversiView,
  ReversiOutcome
>;
