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
const dropDiscActionSchema = z
  .object({
    type: z.literal("DROP_DISC"),
    column: z
      .number()
      .int()
      .min(0)
      .max(CONNECT_FOUR_COLUMNS - 1),
  })
  .strict();
const resignActionSchema = z.object({ type: z.literal("RESIGN") }).strict();
export const connectFourActionSchema = z.discriminatedUnion("type", [
  dropDiscActionSchema,
  resignActionSchema,
]);

const lineWinOutcomeSchema = z
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
  .strict();
const resignationOutcomeSchema = z
  .object({
    type: z.literal("WIN"),
    reason: z.literal("RESIGNATION"),
    winnerSlotId: slotIdSchema,
    resignedSlotId: slotIdSchema,
  })
  .strict();
const drawOutcomeSchema = z.object({ type: z.literal("DRAW") }).strict();
export const connectFourOutcomeSchema = z.union([
  lineWinOutcomeSchema,
  resignationOutcomeSchema,
  drawOutcomeSchema,
]);

export const connectFourStateSchema = z
  .object({
    players: z.tuple([slotIdSchema, slotIdSchema]),
    board: boardSchema,
    nextPlayerIndex: z.union([z.literal(0), z.literal(1)]),
    resignedSlotId: slotIdSchema.nullable(),
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
    if (
      state.resignedSlotId !== null &&
      !state.players.includes(state.resignedSlotId)
    ) {
      context.addIssue({
        code: "custom",
        message: "The resigned slot must be a registered player slot.",
        path: ["resignedSlotId"],
      });
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
    if (
      view.outcome?.type === "WIN" &&
      "reason" in view.outcome &&
      !slots.includes(view.outcome.resignedSlotId)
    ) {
      context.addIssue({
        code: "custom",
        message: "The resigned slot must reference a visible player slot.",
        path: ["outcome", "resignedSlotId"],
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
  if (outcome.type === "DRAW") {
    return Object.freeze({ type: "DRAW" });
  }
  if ("reason" in outcome) {
    return Object.freeze({
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: outcome.winnerSlotId,
      resignedSlotId: outcome.resignedSlotId,
    });
  }
  return Object.freeze({
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
    resignedSlotId:
      parsed.resignedSlotId === null
        ? null
        : (parsed.resignedSlotId as PlayerSlotId),
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

function calculateBoardOutcome(
  board: DeepReadonly<ConnectFourBoard>,
): Exclude<ConnectFourOutcome, { readonly reason: "RESIGNATION" }> | null {
  for (let row = 0; row < CONNECT_FOUR_ROWS; row += 1) {
    for (let column = 0; column < CONNECT_FOUR_COLUMNS; column += 1) {
      const start = row * CONNECT_FOUR_COLUMNS + column;
      const owner = board[start];
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
        if (cells.every((cell) => board[cell] === owner)) {
          return freezeOutcome({
            type: "WIN",
            winnerSlotId: owner,
            winningCells: cells,
          }) as ConnectFourOutcomeV1_0_0;
        }
      }
    }
  }

  return board.every((cell) => cell !== null)
    ? (freezeOutcome({ type: "DRAW" }) as ConnectFourOutcomeV1_0_0)
    : null;
}

function calculateOutcome(
  state: DeepReadonly<ConnectFourState>,
): ConnectFourOutcome | null {
  const boardOutcome = calculateBoardOutcome(state.board);
  if (state.resignedSlotId === null) {
    return boardOutcome;
  }
  if (boardOutcome !== null) {
    throw new Error("Connect Four resignation state is inconsistent.");
  }
  const [firstPlayer, secondPlayer] = state.players;
  return parseOutcome({
    type: "WIN",
    reason: "RESIGNATION",
    winnerSlotId:
      state.resignedSlotId === firstPlayer ? secondPlayer : firstPlayer,
    resignedSlotId: state.resignedSlotId,
  });
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
    resignedSlotId: null,
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
  if (context.action.type === "RESIGN") {
    return {
      status: "accepted",
      state: parseState({
        players: state.players,
        board: state.board,
        nextPlayerIndex: state.nextPlayerIndex,
        resignedSlotId: context.actorSlotId,
      }),
      rng: context.rng,
    };
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
    resignedSlotId: null,
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

type ConnectFourStateV1_0_0 = Omit<ConnectFourState, "resignedSlotId">;
type ConnectFourActionV1_0_0 = Extract<
  ConnectFourAction,
  { readonly type: "DROP_DISC" }
>;
type ConnectFourOutcomeV1_0_0 = Exclude<
  ConnectFourOutcome,
  { readonly reason: "RESIGNATION" }
>;
type ConnectFourViewV1_0_0 = Omit<ConnectFourView, "outcome"> & {
  readonly outcome: ConnectFourOutcomeV1_0_0 | null;
};

const connectFourManifestV1_0_0 = Object.freeze({
  id: connectFourManifest.id,
  gameVersion: defineGameVersion("1.0.0"),
  title: "四子棋",
  description: "两名玩家轮流选择列落子，率先在任一方向连成四子者获胜。",
  defaultConfig: null,
  minPlayers: 2,
  maxPlayers: 2,
  runtime: "turn-based",
  capabilities: Object.freeze({
    hiddenInformation: false,
    deterministicRandomness: false,
    replay: "player-playback",
  }),
}) satisfies GameManifest;

const connectFourStateSchemaV1_0_0 = z
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

function parseStateV1_0_0(input: unknown): ConnectFourStateV1_0_0 {
  const parsed = connectFourStateSchemaV1_0_0.parse(input);
  return Object.freeze({
    players: Object.freeze([...parsed.players]) as readonly [
      PlayerSlotId,
      PlayerSlotId,
    ],
    board: Object.freeze([...parsed.board]) as ConnectFourBoard,
    nextPlayerIndex: parsed.nextPlayerIndex,
  });
}

function createInitialStateV1_0_0(
  context: InitialContext<ConnectFourConfig>,
): Initialized<ConnectFourStateV1_0_0> {
  connectFourConfigSchema.parse(context.config);
  return {
    state: parseStateV1_0_0({
      players: requirePlayers(context.players),
      board: Array<null>(CONNECT_FOUR_CELL_COUNT).fill(null),
      nextPlayerIndex: 0,
    }),
    rng: context.rng,
  };
}

function getOutcomeV1_0_0(
  state: DeepReadonly<ConnectFourStateV1_0_0>,
): ConnectFourOutcomeV1_0_0 | null {
  return calculateBoardOutcome(parseStateV1_0_0(state).board);
}

function transitionV1_0_0(
  context: TransitionContext<ConnectFourStateV1_0_0, ConnectFourActionV1_0_0>,
): Transition<ConnectFourStateV1_0_0> {
  const state = parseStateV1_0_0(context.state);
  if (calculateBoardOutcome(state.board) !== null) {
    return { status: "rejected", code: "MATCH_ALREADY_FINISHED" };
  }
  const [firstPlayer, secondPlayer] = state.players;
  if (
    context.actorSlotId !== firstPlayer &&
    context.actorSlotId !== secondPlayer
  ) {
    return { status: "rejected", code: "NOT_A_PLAYER" };
  }
  if (context.actorSlotId !== state.players[state.nextPlayerIndex]) {
    return { status: "rejected", code: "NOT_YOUR_TURN" };
  }

  const column = context.action.column;
  if (
    !Number.isInteger(column) ||
    column < 0 ||
    column >= CONNECT_FOUR_COLUMNS
  ) {
    return { status: "rejected", code: "COLUMN_OUT_OF_BOUNDS" };
  }
  if (state.board[column] !== null) {
    return { status: "rejected", code: "COLUMN_FULL" };
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
    return { status: "rejected", code: "COLUMN_FULL" };
  }

  const board = [...state.board];
  board[landingCell] = context.actorSlotId;
  return {
    status: "accepted",
    state: parseStateV1_0_0({
      players: state.players,
      board,
      nextPlayerIndex: state.nextPlayerIndex === 0 ? 1 : 0,
    }),
    rng: context.rng,
  };
}

function projectViewV1_0_0(
  context: ViewContext<ConnectFourStateV1_0_0>,
): ConnectFourViewV1_0_0 {
  const state = parseStateV1_0_0(context.state);
  const outcome = calculateBoardOutcome(state.board);
  const [firstPlayer, secondPlayer] = state.players;
  const players: ConnectFourViewV1_0_0["players"] = Object.freeze([
    Object.freeze({ slotId: firstPlayer, disc: "RED" }),
    Object.freeze({ slotId: secondPlayer, disc: "YELLOW" }),
  ]);
  return Object.freeze({
    players,
    board: Object.freeze([...state.board]) as ConnectFourBoard,
    nextTurnSlotId:
      outcome === null ? state.players[state.nextPlayerIndex] : null,
    outcome:
      outcome === null
        ? null
        : (freezeOutcome(outcome) as ConnectFourOutcomeV1_0_0),
    yourDisc:
      context.viewer.kind === "player"
        ? context.viewer.slotId === firstPlayer
          ? "RED"
          : context.viewer.slotId === secondPlayer
            ? "YELLOW"
            : null
        : null,
  });
}

export const connectFourDefinitionV1_0_0 = Object.freeze({
  manifest: connectFourManifestV1_0_0,
  configSchema: connectFourConfigSchema,
  actionSchema: dropDiscActionSchema,
  createInitialState: createInitialStateV1_0_0,
  transition: transitionV1_0_0,
  projectView: projectViewV1_0_0,
  getOutcome: getOutcomeV1_0_0,
}) satisfies GameDefinition<
  ConnectFourConfig,
  ConnectFourStateV1_0_0,
  ConnectFourActionV1_0_0,
  ConnectFourViewV1_0_0,
  ConnectFourOutcomeV1_0_0
>;
