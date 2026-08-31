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

import { GOMOKU_MAX_CELL_COUNT, GOMOKU_WIN_LENGTH } from "../constants.js";
import { gomokuManifest } from "../manifest.js";
import type {
  GomokuAction,
  GomokuBoard,
  GomokuConfig,
  GomokuOutcome,
  GomokuRuleErrorCode,
  GomokuState,
  GomokuView,
} from "../types.js";

export type {
  GomokuAction,
  GomokuBoard,
  GomokuBoardSize,
  GomokuConfig,
  GomokuOutcome,
  GomokuRuleErrorCode,
  GomokuState,
  GomokuStone,
  GomokuView,
} from "../types.js";
export {
  GOMOKU_BOARD_SIZES,
  GOMOKU_DEFAULT_BOARD_SIZE,
  GOMOKU_MAX_CELL_COUNT,
  GOMOKU_WIN_LENGTH,
} from "../constants.js";

const slotIdSchema = z.string().min(1);
const cellIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(GOMOKU_MAX_CELL_COUNT - 1);

export const gomokuConfigSchema = z
  .object({
    boardSize: z.union([z.literal(15), z.literal(19)]),
    winLength: z.literal(GOMOKU_WIN_LENGTH),
  })
  .strict();

export const gomokuActionSchema = z
  .object({
    type: z.literal("PLACE_STONE"),
    cell: cellIndexSchema,
  })
  .strict();

export const gomokuOutcomeSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("WIN"),
      winnerSlotId: slotIdSchema,
      winningCells: z.tuple([
        cellIndexSchema,
        cellIndexSchema,
        cellIndexSchema,
        cellIndexSchema,
        cellIndexSchema,
      ]),
    })
    .strict(),
  z.object({ type: z.literal("DRAW") }).strict(),
]);

const boardSchema = z
  .array(slotIdSchema.nullable())
  .min(15 * 15)
  .max(GOMOKU_MAX_CELL_COUNT);

export const gomokuStateSchema = z
  .object({
    config: gomokuConfigSchema,
    players: z.tuple([slotIdSchema, slotIdSchema]),
    board: boardSchema,
    nextPlayerIndex: z.union([z.literal(0), z.literal(1)]),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.players[0] === state.players[1]) {
      context.addIssue({
        code: "custom",
        message: "Gomoku player slots must be distinct.",
        path: ["players"],
      });
    }
    if (state.board.length !== state.config.boardSize ** 2) {
      context.addIssue({
        code: "custom",
        message: "Gomoku board length must match the configured board size.",
        path: ["board"],
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

export const gomokuViewSchema = z
  .object({
    boardSize: z.union([z.literal(15), z.literal(19)]),
    winLength: z.literal(GOMOKU_WIN_LENGTH),
    players: z.tuple([
      z.object({ slotId: slotIdSchema, stone: z.literal("BLACK") }).strict(),
      z.object({ slotId: slotIdSchema, stone: z.literal("WHITE") }).strict(),
    ]),
    board: boardSchema,
    nextTurnSlotId: slotIdSchema.nullable(),
    outcome: gomokuOutcomeSchema.nullable(),
    yourStone: z.enum(["BLACK", "WHITE"]).nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const slots = view.players.map((player) => player.slotId);
    if (slots[0] === slots[1]) {
      context.addIssue({
        code: "custom",
        message: "Gomoku view player slots must be distinct.",
        path: ["players"],
      });
    }
    if (view.board.length !== view.boardSize ** 2) {
      context.addIssue({
        code: "custom",
        message: "Gomoku view board length must match its board size.",
        path: ["board"],
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
    if (
      view.outcome?.type === "WIN" &&
      !slots.includes(view.outcome.winnerSlotId)
    ) {
      context.addIssue({
        code: "custom",
        message: "The winner must reference a visible player slot.",
        path: ["outcome", "winnerSlotId"],
      });
    }
    if (
      view.outcome?.type === "WIN" &&
      view.outcome.winningCells.some(
        (cell) => cell >= view.boardSize * view.boardSize,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Winning cells must be inside the visible board.",
        path: ["outcome", "winningCells"],
      });
    }
  });

const WIN_DIRECTIONS = Object.freeze([
  Object.freeze([0, 1] as const),
  Object.freeze([1, 0] as const),
  Object.freeze([1, 1] as const),
  Object.freeze([1, -1] as const),
] as const);

function freezeConfig(config: GomokuConfig): GomokuConfig {
  return Object.freeze({
    boardSize: config.boardSize,
    winLength: config.winLength,
  });
}

function parseConfig(input: unknown): GomokuConfig {
  return freezeConfig(
    gomokuConfigSchema.parse(input) as unknown as GomokuConfig,
  );
}

function freezeOutcome(outcome: GomokuOutcome): GomokuOutcome {
  return outcome.type === "DRAW"
    ? Object.freeze({ type: "DRAW" })
    : Object.freeze({
        type: "WIN",
        winnerSlotId: outcome.winnerSlotId,
        winningCells: Object.freeze([...outcome.winningCells]) as readonly [
          number,
          number,
          number,
          number,
          number,
        ],
      });
}

function parseOutcome(input: unknown): GomokuOutcome {
  return freezeOutcome(
    gomokuOutcomeSchema.parse(input) as unknown as GomokuOutcome,
  );
}

function parseState(input: unknown): GomokuState {
  const parsed = gomokuStateSchema.parse(input);
  return Object.freeze({
    config: freezeConfig(parsed.config),
    players: Object.freeze([...parsed.players]) as readonly [
      PlayerSlotId,
      PlayerSlotId,
    ],
    board: Object.freeze([...parsed.board]) as GomokuBoard,
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
    throw new Error("Gomoku requires exactly two distinct player slots.");
  }
  return Object.freeze([first, second]);
}

function calculateOutcome(
  state: DeepReadonly<GomokuState>,
): GomokuOutcome | null {
  const { boardSize, winLength } = state.config;
  for (let row = 0; row < boardSize; row += 1) {
    for (let column = 0; column < boardSize; column += 1) {
      const start = row * boardSize + column;
      const owner = state.board[start];
      if (owner === null || owner === undefined) continue;

      for (const [rowStep, columnStep] of WIN_DIRECTIONS) {
        const endRow = row + rowStep * (winLength - 1);
        const endColumn = column + columnStep * (winLength - 1);
        if (
          endRow < 0 ||
          endRow >= boardSize ||
          endColumn < 0 ||
          endColumn >= boardSize
        ) {
          continue;
        }
        const cells = Array.from(
          { length: winLength },
          (_, offset) =>
            (row + rowStep * offset) * boardSize + column + columnStep * offset,
        ) as [number, number, number, number, number];
        if (cells.every((cell) => state.board[cell] === owner)) {
          return parseOutcome({
            type: "WIN",
            winnerSlotId: owner,
            winningCells: cells,
          });
        }
      }
    }
  }

  return state.board.every((cell) => cell !== null)
    ? parseOutcome({ type: "DRAW" })
    : null;
}

export function createInitialState(
  context: InitialContext<GomokuConfig>,
): Initialized<GomokuState> {
  const config = parseConfig(context.config);
  const players = requirePlayers(context.players);
  const state = parseState({
    config,
    players,
    board: Array<null>(config.boardSize ** 2).fill(null),
    nextPlayerIndex: 0,
  });
  return { state, rng: context.rng };
}

export function getOutcome(
  state: DeepReadonly<GomokuState>,
): GomokuOutcome | null {
  return calculateOutcome(parseState(state));
}

function reject(code: GomokuRuleErrorCode): Transition<GomokuState> {
  return { status: "rejected", code };
}

export function transition(
  context: TransitionContext<GomokuState, GomokuAction>,
): Transition<GomokuState> {
  const state = parseState(context.state);
  if (calculateOutcome(state) !== null) {
    return reject("MATCH_ALREADY_FINISHED");
  }

  const [firstPlayer, secondPlayer] = state.players;
  if (
    context.actorSlotId !== firstPlayer &&
    context.actorSlotId !== secondPlayer
  ) {
    return reject("NOT_A_PLAYER");
  }
  if (context.actorSlotId !== state.players[state.nextPlayerIndex]) {
    return reject("NOT_YOUR_TURN");
  }

  const cell = context.action.cell;
  if (
    !Number.isInteger(cell) ||
    cell < 0 ||
    cell >= state.config.boardSize ** 2
  ) {
    return reject("CELL_OUT_OF_BOUNDS");
  }
  if (state.board[cell] !== null) {
    return reject("CELL_OCCUPIED");
  }

  const board = [...state.board];
  board[cell] = context.actorSlotId;
  const nextState = parseState({
    config: state.config,
    players: state.players,
    board,
    nextPlayerIndex: state.nextPlayerIndex === 0 ? 1 : 0,
  });
  return { status: "accepted", state: nextState, rng: context.rng };
}

function freezeView(view: GomokuView): GomokuView {
  return Object.freeze({
    boardSize: view.boardSize,
    winLength: view.winLength,
    players: Object.freeze(
      view.players.map((player) => Object.freeze({ ...player })),
    ) as GomokuView["players"],
    board: Object.freeze([...view.board]) as GomokuBoard,
    nextTurnSlotId: view.nextTurnSlotId,
    outcome: view.outcome === null ? null : freezeOutcome(view.outcome),
    yourStone: view.yourStone,
  });
}

export function projectView(context: ViewContext<GomokuState>): GomokuView {
  const state = parseState(context.state);
  const outcome = calculateOutcome(state);
  const [firstPlayer, secondPlayer] = state.players;
  const parsed = gomokuViewSchema.parse({
    boardSize: state.config.boardSize,
    winLength: state.config.winLength,
    players: [
      { slotId: firstPlayer, stone: "BLACK" },
      { slotId: secondPlayer, stone: "WHITE" },
    ],
    board: state.board,
    nextTurnSlotId:
      outcome === null ? state.players[state.nextPlayerIndex] : null,
    outcome,
    yourStone:
      context.viewer.kind === "player"
        ? context.viewer.slotId === firstPlayer
          ? "BLACK"
          : context.viewer.slotId === secondPlayer
            ? "WHITE"
            : null
        : null,
  }) as unknown as GomokuView;
  return freezeView(parsed);
}

export const gomokuDefinition = {
  manifest: gomokuManifest,
  configSchema: gomokuConfigSchema,
  actionSchema: gomokuActionSchema,
  createInitialState,
  transition,
  projectView,
  getOutcome,
} satisfies GameDefinition<
  GomokuConfig,
  GomokuState,
  GomokuAction,
  GomokuView,
  GomokuOutcome
>;
