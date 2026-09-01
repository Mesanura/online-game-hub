import type {
  DeepReadonly,
  GameDefinition,
  GameManifest,
  InitialContext,
  Initialized,
  PlayerSlotId,
  Transition,
  TransitionContext,
  ViewContext,
} from "@online-game-hub/game-sdk";
import { defineGameVersion } from "@online-game-hub/game-sdk";
import { z } from "zod";

import { ticTacToeManifest } from "../manifest.js";

export type TicTacToeConfig = null;
export type TicTacToeCellIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type TicTacToeMark = "X" | "O";
export type TicTacToeBoard = readonly [
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
];

type MutableTicTacToeBoard = [
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
  PlayerSlotId | null,
];

export type TicTacToeState = {
  readonly players: readonly [PlayerSlotId, PlayerSlotId];
  readonly board: TicTacToeBoard;
  readonly nextPlayerIndex: 0 | 1;
  readonly resignedSlotId: PlayerSlotId | null;
};

export type TicTacToeOutcome =
  | {
      readonly type: "WIN";
      readonly winnerSlotId: PlayerSlotId;
      readonly winningCells: readonly [
        TicTacToeCellIndex,
        TicTacToeCellIndex,
        TicTacToeCellIndex,
      ];
    }
  | {
      readonly type: "WIN";
      readonly reason: "RESIGNATION";
      readonly winnerSlotId: PlayerSlotId;
      readonly resignedSlotId: PlayerSlotId;
    }
  | { readonly type: "DRAW" };

export type TicTacToeView = {
  readonly players: readonly [
    { readonly slotId: PlayerSlotId; readonly mark: "X" },
    { readonly slotId: PlayerSlotId; readonly mark: "O" },
  ];
  readonly board: TicTacToeBoard;
  readonly nextTurnSlotId: PlayerSlotId | null;
  readonly outcome: TicTacToeOutcome | null;
  readonly yourMark: TicTacToeMark | null;
};

export type TicTacToeRuleErrorCode =
  | "NOT_A_PLAYER"
  | "NOT_YOUR_TURN"
  | "CELL_OUT_OF_BOUNDS"
  | "CELL_OCCUPIED"
  | "MATCH_ALREADY_FINISHED";

const cellIndexSchema = z.union([
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

export const ticTacToeConfigSchema = z.null();
const placeMarkActionSchema = z
  .object({
    type: z.literal("PLACE_MARK"),
    cell: cellIndexSchema,
  })
  .strict();
const resignActionSchema = z.object({ type: z.literal("RESIGN") }).strict();
export const ticTacToeActionSchema = z.discriminatedUnion("type", [
  placeMarkActionSchema,
  resignActionSchema,
]);
export type TicTacToeAction = z.infer<typeof ticTacToeActionSchema>;

const WINNING_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const satisfies readonly (readonly [
  TicTacToeCellIndex,
  TicTacToeCellIndex,
  TicTacToeCellIndex,
])[];

function createEmptyBoard(): TicTacToeBoard {
  return Object.freeze([null, null, null, null, null, null, null, null, null]);
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
    throw new Error("Tic-Tac-Toe requires exactly two distinct player slots.");
  }

  return Object.freeze([first, second]);
}

export function createInitialState(
  context: InitialContext<TicTacToeConfig>,
): Initialized<TicTacToeState> {
  const players = requirePlayers(context.players);
  const state: TicTacToeState = Object.freeze({
    players,
    board: createEmptyBoard(),
    nextPlayerIndex: 0,
    resignedSlotId: null,
  });
  return { state, rng: context.rng };
}

function winningCells(
  board: DeepReadonly<TicTacToeBoard>,
): (typeof WINNING_LINES)[number] | null {
  for (const line of WINNING_LINES) {
    const [first, second, third] = line;
    const owner = board[first];
    if (owner !== null && owner === board[second] && owner === board[third]) {
      return line;
    }
  }

  return null;
}

export function getOutcome(
  state: DeepReadonly<TicTacToeState>,
): TicTacToeOutcome | null {
  const boardOutcome = getBoardOutcome(state.board);
  if (state.resignedSlotId !== null) {
    const [firstPlayer, secondPlayer] = state.players;
    if (
      (state.resignedSlotId !== firstPlayer &&
        state.resignedSlotId !== secondPlayer) ||
      boardOutcome !== null
    ) {
      throw new Error("Tic-Tac-Toe resignation state is inconsistent.");
    }

    return Object.freeze({
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId:
        state.resignedSlotId === firstPlayer ? secondPlayer : firstPlayer,
      resignedSlotId: state.resignedSlotId,
    });
  }

  return boardOutcome;
}

function getBoardOutcome(
  board: DeepReadonly<TicTacToeBoard>,
): Exclude<TicTacToeOutcome, { readonly reason: "RESIGNATION" }> | null {
  const line = winningCells(board);
  if (line !== null) {
    const winnerSlotId = board[line[0]];
    if (winnerSlotId === null) {
      throw new Error("Winning line must have an owner.");
    }

    const frozenLine = Object.freeze([line[0], line[1], line[2]]) as readonly [
      TicTacToeCellIndex,
      TicTacToeCellIndex,
      TicTacToeCellIndex,
    ];
    return Object.freeze({
      type: "WIN",
      winnerSlotId,
      winningCells: frozenLine,
    });
  }

  return board.every((cell) => cell !== null)
    ? Object.freeze({ type: "DRAW" })
    : null;
}

function reject(code: TicTacToeRuleErrorCode): Transition<TicTacToeState> {
  return { status: "rejected", code };
}

export function transition(
  context: TransitionContext<TicTacToeState, TicTacToeAction>,
): Transition<TicTacToeState> {
  if (getOutcome(context.state) !== null) {
    return reject("MATCH_ALREADY_FINISHED");
  }

  const [firstPlayer, secondPlayer] = context.state.players;
  if (
    context.actorSlotId !== firstPlayer &&
    context.actorSlotId !== secondPlayer
  ) {
    return reject("NOT_A_PLAYER");
  }

  if (context.action.type === "RESIGN") {
    const state: TicTacToeState = Object.freeze({
      players: context.state.players,
      board: context.state.board,
      nextPlayerIndex: context.state.nextPlayerIndex,
      resignedSlotId: context.actorSlotId,
    });
    return { status: "accepted", state, rng: context.rng };
  }

  const expectedPlayer = context.state.players[context.state.nextPlayerIndex];
  if (context.actorSlotId !== expectedPlayer) {
    return reject("NOT_YOUR_TURN");
  }

  const rawCell: number = context.action.cell;
  if (!Number.isInteger(rawCell) || rawCell < 0 || rawCell > 8) {
    return reject("CELL_OUT_OF_BOUNDS");
  }
  const cell = rawCell as TicTacToeCellIndex;

  if (context.state.board[cell] !== null) {
    return reject("CELL_OCCUPIED");
  }

  const board = [...context.state.board] as MutableTicTacToeBoard;
  board[cell] = context.actorSlotId;
  const state: TicTacToeState = Object.freeze({
    players: context.state.players,
    board: Object.freeze(board),
    nextPlayerIndex: context.state.nextPlayerIndex === 0 ? 1 : 0,
    resignedSlotId: null,
  });

  return { status: "accepted", state, rng: context.rng };
}

export function projectView(
  context: ViewContext<TicTacToeState>,
): TicTacToeView {
  const outcome = getOutcome(context.state);
  const [firstPlayer, secondPlayer] = context.state.players;
  const players: TicTacToeView["players"] = Object.freeze([
    Object.freeze({ slotId: firstPlayer, mark: "X" }),
    Object.freeze({ slotId: secondPlayer, mark: "O" }),
  ]);
  return Object.freeze({
    players,
    board: Object.freeze([...context.state.board]) as TicTacToeBoard,
    nextTurnSlotId:
      outcome === null
        ? context.state.players[context.state.nextPlayerIndex]
        : null,
    outcome,
    yourMark:
      context.viewer.kind === "player"
        ? context.viewer.slotId === firstPlayer
          ? "X"
          : context.viewer.slotId === secondPlayer
            ? "O"
            : null
        : null,
  });
}

export const ticTacToeDefinition = {
  manifest: ticTacToeManifest,
  configSchema: ticTacToeConfigSchema,
  actionSchema: ticTacToeActionSchema,
  createInitialState,
  transition,
  projectView,
  getOutcome,
} satisfies GameDefinition<
  TicTacToeConfig,
  TicTacToeState,
  TicTacToeAction,
  TicTacToeView,
  TicTacToeOutcome
>;

type TicTacToeStateV1_0_0 = Omit<TicTacToeState, "resignedSlotId">;
type TicTacToeActionV1_0_0 = z.infer<typeof placeMarkActionSchema>;
type TicTacToeOutcomeV1_0_0 = Exclude<
  TicTacToeOutcome,
  { readonly reason: "RESIGNATION" }
>;
type TicTacToeViewV1_0_0 = Omit<TicTacToeView, "outcome"> & {
  readonly outcome: TicTacToeOutcomeV1_0_0 | null;
};

const ticTacToeManifestV1_0_0 = Object.freeze({
  id: ticTacToeManifest.id,
  gameVersion: defineGameVersion("1.0.0"),
  title: "井字棋",
  description: "两名玩家轮流在 3×3 棋盘落子，率先连成一线者获胜。",
  defaultConfig: null,
  minPlayers: 2,
  maxPlayers: 2,
  runtime: "turn-based",
  capabilities: Object.freeze({
    hiddenInformation: false,
    deterministicRandomness: false,
  }),
}) satisfies GameManifest;

function createInitialStateV1_0_0(
  context: InitialContext<TicTacToeConfig>,
): Initialized<TicTacToeStateV1_0_0> {
  return {
    state: Object.freeze({
      players: requirePlayers(context.players),
      board: createEmptyBoard(),
      nextPlayerIndex: 0,
    }),
    rng: context.rng,
  };
}

function getOutcomeV1_0_0(
  state: DeepReadonly<TicTacToeStateV1_0_0>,
): TicTacToeOutcomeV1_0_0 | null {
  return getBoardOutcome(state.board);
}

function transitionV1_0_0(
  context: TransitionContext<TicTacToeStateV1_0_0, TicTacToeActionV1_0_0>,
): Transition<TicTacToeStateV1_0_0> {
  if (getOutcomeV1_0_0(context.state) !== null) {
    return { status: "rejected", code: "MATCH_ALREADY_FINISHED" };
  }

  const [firstPlayer, secondPlayer] = context.state.players;
  if (
    context.actorSlotId !== firstPlayer &&
    context.actorSlotId !== secondPlayer
  ) {
    return { status: "rejected", code: "NOT_A_PLAYER" };
  }
  if (
    context.actorSlotId !== context.state.players[context.state.nextPlayerIndex]
  ) {
    return { status: "rejected", code: "NOT_YOUR_TURN" };
  }

  const rawCell: number = context.action.cell;
  if (!Number.isInteger(rawCell) || rawCell < 0 || rawCell > 8) {
    return { status: "rejected", code: "CELL_OUT_OF_BOUNDS" };
  }
  const cell = rawCell as TicTacToeCellIndex;
  if (context.state.board[cell] !== null) {
    return { status: "rejected", code: "CELL_OCCUPIED" };
  }

  const board = [...context.state.board] as MutableTicTacToeBoard;
  board[cell] = context.actorSlotId;
  return {
    status: "accepted",
    state: Object.freeze({
      players: context.state.players,
      board: Object.freeze(board),
      nextPlayerIndex: context.state.nextPlayerIndex === 0 ? 1 : 0,
    }),
    rng: context.rng,
  };
}

function projectViewV1_0_0(
  context: ViewContext<TicTacToeStateV1_0_0>,
): TicTacToeViewV1_0_0 {
  const outcome = getOutcomeV1_0_0(context.state);
  const [firstPlayer, secondPlayer] = context.state.players;
  const players: TicTacToeViewV1_0_0["players"] = Object.freeze([
    Object.freeze({ slotId: firstPlayer, mark: "X" }),
    Object.freeze({ slotId: secondPlayer, mark: "O" }),
  ]);
  return Object.freeze({
    players,
    board: Object.freeze([...context.state.board]) as TicTacToeBoard,
    nextTurnSlotId:
      outcome === null
        ? context.state.players[context.state.nextPlayerIndex]
        : null,
    outcome,
    yourMark:
      context.viewer.kind === "player"
        ? context.viewer.slotId === firstPlayer
          ? "X"
          : context.viewer.slotId === secondPlayer
            ? "O"
            : null
        : null,
  });
}

export const ticTacToeDefinitionV1_0_0 = Object.freeze({
  manifest: ticTacToeManifestV1_0_0,
  configSchema: ticTacToeConfigSchema,
  actionSchema: placeMarkActionSchema,
  createInitialState: createInitialStateV1_0_0,
  transition: transitionV1_0_0,
  projectView: projectViewV1_0_0,
  getOutcome: getOutcomeV1_0_0,
}) satisfies GameDefinition<
  TicTacToeConfig,
  TicTacToeStateV1_0_0,
  TicTacToeActionV1_0_0,
  TicTacToeViewV1_0_0,
  TicTacToeOutcomeV1_0_0
>;
