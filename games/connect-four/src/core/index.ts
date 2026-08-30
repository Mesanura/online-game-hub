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

import {
  CONNECT_FOUR_CELL_COUNT,
  CONNECT_FOUR_COLUMNS,
  CONNECT_FOUR_ROWS,
} from "../constants.js";
import { connectFourManifest } from "../manifest.js";
import type {
  ConnectFourAction,
  ConnectFourBoard,
  ConnectFourConfig,
  ConnectFourOutcome,
  ConnectFourRuleErrorCode,
  ConnectFourState,
  ConnectFourView,
} from "../types.js";

export type {
  ConnectFourAction,
  ConnectFourBoard,
  ConnectFourConfig,
  ConnectFourDisc,
  ConnectFourOutcome,
  ConnectFourRuleErrorCode,
  ConnectFourState,
  ConnectFourView,
} from "../types.js";
export {
  CONNECT_FOUR_CELL_COUNT,
  CONNECT_FOUR_COLUMNS,
  CONNECT_FOUR_ROWS,
} from "../constants.js";

const slotIdSchema = z.string().min(1);
const boardSchema = z
  .array(slotIdSchema.nullable())
  .length(CONNECT_FOUR_CELL_COUNT);
const cellIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(CONNECT_FOUR_CELL_COUNT - 1);

export const connectFourConfigSchema = z.null();
export const connectFourActionSchema = z
  .object({
    type: z.literal("DROP_DISC"),
    column: z
      .number()
      .int()
      .min(0)
      .max(CONNECT_FOUR_COLUMNS - 1),
  })
  .strict();

export const connectFourOutcomeSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("WIN"),
      winnerSlotId: slotIdSchema,
      winningCells: z.tuple([
        cellIndexSchema,
        cellIndexSchema,
        cellIndexSchema,
        cellIndexSchema,
      ]),
    })
    .strict(),
  z.object({ type: z.literal("DRAW") }).strict(),
]);

export const connectFourStateSchema = z
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
        message: "Connect Four player slots must be distinct.",
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

export const connectFourViewSchema = z
  .object({
    players: z.tuple([
      z.object({ slotId: slotIdSchema, disc: z.literal("RED") }).strict(),
      z.object({ slotId: slotIdSchema, disc: z.literal("YELLOW") }).strict(),
    ]),
    board: boardSchema,
    nextTurnSlotId: slotIdSchema.nullable(),
    outcome: connectFourOutcomeSchema.nullable(),
    yourDisc: z.enum(["RED", "YELLOW"]).nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const slots = view.players.map((player) => player.slotId);
    if (slots[0] === slots[1]) {
      context.addIssue({
        code: "custom",
        message: "Connect Four view player slots must be distinct.",
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
  });

const WIN_DIRECTIONS = Object.freeze([
  Object.freeze([0, 1] as const),
  Object.freeze([1, 0] as const),
  Object.freeze([1, 1] as const),
  Object.freeze([1, -1] as const),
] as const);

function freezeOutcome(outcome: ConnectFourOutcome): ConnectFourOutcome {
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
        ],
      });
}

function parseOutcome(input: unknown): ConnectFourOutcome {
  return freezeOutcome(
    connectFourOutcomeSchema.parse(input) as unknown as ConnectFourOutcome,
  );
}

function parseState(input: unknown): ConnectFourState {
  const parsed = connectFourStateSchema.parse(input);
  return Object.freeze({
    players: Object.freeze([...parsed.players]) as readonly [
      PlayerSlotId,
      PlayerSlotId,
    ],
    board: Object.freeze([...parsed.board]) as ConnectFourBoard,
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
    throw new Error("Connect Four requires exactly two distinct player slots.");
  }
  return Object.freeze([first, second]);
}

function calculateOutcome(
  state: DeepReadonly<ConnectFourState>,
): ConnectFourOutcome | null {
  for (let row = 0; row < CONNECT_FOUR_ROWS; row += 1) {
    for (let column = 0; column < CONNECT_FOUR_COLUMNS; column += 1) {
      const start = row * CONNECT_FOUR_COLUMNS + column;
      const owner = state.board[start];
      if (owner === null || owner === undefined) continue;

      for (const direction of WIN_DIRECTIONS) {
        const rowStep = direction[0];
        const columnStep = direction[1];
        const endRow = row + rowStep * 3;
        const endColumn = column + columnStep * 3;
        if (
          endRow < 0 ||
          endRow >= CONNECT_FOUR_ROWS ||
          endColumn < 0 ||
          endColumn >= CONNECT_FOUR_COLUMNS
        ) {
          continue;
        }
        const cells = [0, 1, 2, 3].map(
          (offset) =>
            (row + rowStep * offset) * CONNECT_FOUR_COLUMNS +
            column +
            columnStep * offset,
        ) as [number, number, number, number];
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
  context: InitialContext<ConnectFourConfig>,
): Initialized<ConnectFourState> {
  connectFourConfigSchema.parse(context.config);
  const players = requirePlayers(context.players);
  const state = parseState({
    players,
    board: Array<null>(CONNECT_FOUR_CELL_COUNT).fill(null),
    nextPlayerIndex: 0,
  });
  return { state, rng: context.rng };
}

export function getOutcome(
  state: DeepReadonly<ConnectFourState>,
): ConnectFourOutcome | null {
  return calculateOutcome(parseState(state));
}

function reject(code: ConnectFourRuleErrorCode): Transition<ConnectFourState> {
  return { status: "rejected", code };
}

export function transition(
  context: TransitionContext<ConnectFourState, ConnectFourAction>,
): Transition<ConnectFourState> {
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

  const column = context.action.column;
  if (
    !Number.isInteger(column) ||
    column < 0 ||
    column >= CONNECT_FOUR_COLUMNS
  ) {
    return reject("COLUMN_OUT_OF_BOUNDS");
  }
  if (state.board[column] !== null) {
    return reject("COLUMN_FULL");
  }

  let landingCell = -1;
  for (let row = CONNECT_FOUR_ROWS - 1; row >= 0; row -= 1) {
    const cell = row * CONNECT_FOUR_COLUMNS + column;
    if (state.board[cell] === null) {
      landingCell = cell;
      break;
    }
  }
  if (landingCell === -1) {
    return reject("COLUMN_FULL");
  }

  const board = [...state.board];
  board[landingCell] = context.actorSlotId;
  const nextState = parseState({
    players: state.players,
    board,
    nextPlayerIndex: state.nextPlayerIndex === 0 ? 1 : 0,
  });
  return { status: "accepted", state: nextState, rng: context.rng };
}

function freezeView(view: ConnectFourView): ConnectFourView {
  return Object.freeze({
    players: Object.freeze(
      view.players.map((player) => Object.freeze({ ...player })),
    ) as ConnectFourView["players"],
    board: Object.freeze([...view.board]) as ConnectFourBoard,
    nextTurnSlotId: view.nextTurnSlotId,
    outcome: view.outcome === null ? null : freezeOutcome(view.outcome),
    yourDisc: view.yourDisc,
  });
}

export function projectView(
  context: ViewContext<ConnectFourState>,
): ConnectFourView {
  const state = parseState(context.state);
  const outcome = calculateOutcome(state);
  const [firstPlayer, secondPlayer] = state.players;
  const parsed = connectFourViewSchema.parse({
    players: [
      { slotId: firstPlayer, disc: "RED" },
      { slotId: secondPlayer, disc: "YELLOW" },
    ],
    board: state.board,
    nextTurnSlotId:
      outcome === null ? state.players[state.nextPlayerIndex] : null,
    outcome,
    yourDisc:
      context.viewer.kind === "player"
        ? context.viewer.slotId === firstPlayer
          ? "RED"
          : context.viewer.slotId === secondPlayer
            ? "YELLOW"
            : null
        : null,
  }) as unknown as ConnectFourView;
  return freezeView(parsed);
}

export const connectFourDefinition = {
  manifest: connectFourManifest,
  configSchema: connectFourConfigSchema,
  actionSchema: connectFourActionSchema,
  createInitialState,
  transition,
  projectView,
  getOutcome,
} satisfies GameDefinition<
  ConnectFourConfig,
  ConnectFourState,
  ConnectFourAction,
  ConnectFourView,
  ConnectFourOutcome
>;
