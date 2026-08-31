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

import { HEX_BOARD_SIZE, HEX_CELL_COUNT } from "../constants.js";
import { hexManifest } from "../manifest.js";
import type {
  HexAction,
  HexBoard,
  HexConfig,
  HexOutcome,
  HexRuleErrorCode,
  HexState,
  HexView,
} from "../types.js";

export type {
  HexAction,
  HexBoard,
  HexColor,
  HexConfig,
  HexOutcome,
  HexRuleErrorCode,
  HexState,
  HexView,
} from "../types.js";
export { HEX_BOARD_SIZE, HEX_CELL_COUNT } from "../constants.js";

const slotIdSchema = z.string().min(1);
const cellIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(HEX_CELL_COUNT - 1);

export const hexConfigSchema = z.null();

export const hexActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("PLACE_STONE"),
      cell: cellIndexSchema,
    })
    .strict(),
  z.object({ type: z.literal("RESIGN") }).strict(),
]);

const connectionOutcomeSchema = z
  .object({
    type: z.literal("WIN"),
    reason: z.literal("CONNECTION"),
    winnerSlotId: slotIdSchema,
    winningPath: z
      .array(cellIndexSchema)
      .min(HEX_BOARD_SIZE)
      .max(HEX_CELL_COUNT),
  })
  .strict()
  .superRefine((outcome, context) => {
    if (new Set(outcome.winningPath).size !== outcome.winningPath.length) {
      context.addIssue({
        code: "custom",
        message: "A Hex winning path may not repeat a cell.",
        path: ["winningPath"],
      });
    }
  });

const resignationOutcomeSchema = z
  .object({
    type: z.literal("WIN"),
    reason: z.literal("RESIGNATION"),
    winnerSlotId: slotIdSchema,
    resignedSlotId: slotIdSchema,
  })
  .strict();

export const hexOutcomeSchema = z.discriminatedUnion("reason", [
  connectionOutcomeSchema,
  resignationOutcomeSchema,
]);

const boardSchema = z.array(slotIdSchema.nullable()).length(HEX_CELL_COUNT);

export const hexStateSchema = z
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
        message: "Hex player slots must be distinct.",
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
        message: "The resigned slot must be a registered player.",
        path: ["resignedSlotId"],
      });
    }
  });

export const hexViewSchema = z
  .object({
    players: z.tuple([
      z.object({ slotId: slotIdSchema, color: z.literal("BLUE") }).strict(),
      z.object({ slotId: slotIdSchema, color: z.literal("RED") }).strict(),
    ]),
    board: boardSchema,
    nextTurnSlotId: slotIdSchema.nullable(),
    outcome: hexOutcomeSchema.nullable(),
    yourColor: z.enum(["BLUE", "RED"]).nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const slots = view.players.map((player) => player.slotId);
    if (slots[0] === slots[1]) {
      context.addIssue({
        code: "custom",
        message: "Hex view player slots must be distinct.",
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
    const outcome = view.outcome;
    if (outcome === null) return;
    if (!slots.includes(outcome.winnerSlotId)) {
      context.addIssue({
        code: "custom",
        message: "The winner must reference a visible player slot.",
        path: ["outcome", "winnerSlotId"],
      });
    }
    if (
      outcome.reason === "RESIGNATION" &&
      (!slots.includes(outcome.resignedSlotId) ||
        outcome.resignedSlotId === outcome.winnerSlotId)
    ) {
      context.addIssue({
        code: "custom",
        message: "The resigned slot must be the other visible player.",
        path: ["outcome", "resignedSlotId"],
      });
    }
    if (outcome.reason === "CONNECTION") {
      const winnerIndex = slots.indexOf(outcome.winnerSlotId);
      if (
        outcome.winningPath.some(
          (cell) => view.board[cell] !== outcome.winnerSlotId,
        ) ||
        !isConnectedPath(outcome.winningPath, winnerIndex)
      ) {
        context.addIssue({
          code: "custom",
          message: "The winning path must connect the winner's two edges.",
          path: ["outcome", "winningPath"],
        });
      }
    }
  });

function rowOf(cell: number): number {
  return Math.floor(cell / HEX_BOARD_SIZE);
}

function columnOf(cell: number): number {
  return cell % HEX_BOARD_SIZE;
}

function neighborCells(cell: number): readonly number[] {
  const row = rowOf(cell);
  const column = columnOf(cell);
  const candidates = [
    [row - 1, column],
    [row - 1, column + 1],
    [row, column - 1],
    [row, column + 1],
    [row + 1, column - 1],
    [row + 1, column],
  ] as const;
  const neighbors: number[] = [];
  for (const [candidateRow, candidateColumn] of candidates) {
    if (
      candidateRow >= 0 &&
      candidateRow < HEX_BOARD_SIZE &&
      candidateColumn >= 0 &&
      candidateColumn < HEX_BOARD_SIZE
    ) {
      neighbors.push(candidateRow * HEX_BOARD_SIZE + candidateColumn);
    }
  }
  return neighbors;
}

function areNeighbors(first: number, second: number): boolean {
  return neighborCells(first).includes(second);
}

function isConnectedPath(
  path: readonly number[],
  playerIndex: number,
): boolean {
  const first = path[0];
  const last = path.at(-1);
  if (first === undefined || last === undefined) return false;
  const touchesStart =
    playerIndex === 0 ? rowOf(first) === 0 : columnOf(first) === 0;
  const touchesTarget =
    playerIndex === 0
      ? rowOf(last) === HEX_BOARD_SIZE - 1
      : columnOf(last) === HEX_BOARD_SIZE - 1;
  return (
    touchesStart &&
    touchesTarget &&
    path.slice(1).every((cell, index) => areNeighbors(path[index] ?? -1, cell))
  );
}

function freezeOutcome(outcome: HexOutcome): HexOutcome {
  return outcome.reason === "CONNECTION"
    ? Object.freeze({
        type: "WIN",
        reason: "CONNECTION",
        winnerSlotId: outcome.winnerSlotId,
        winningPath: Object.freeze([...outcome.winningPath]),
      })
    : Object.freeze({
        type: "WIN",
        reason: "RESIGNATION",
        winnerSlotId: outcome.winnerSlotId,
        resignedSlotId: outcome.resignedSlotId,
      });
}

function parseOutcome(input: unknown): HexOutcome {
  return freezeOutcome(hexOutcomeSchema.parse(input) as unknown as HexOutcome);
}

function parseState(input: unknown): HexState {
  const parsed = hexStateSchema.parse(input);
  return Object.freeze({
    players: Object.freeze([...parsed.players]) as readonly [
      PlayerSlotId,
      PlayerSlotId,
    ],
    board: Object.freeze([...parsed.board]) as HexBoard,
    nextPlayerIndex: parsed.nextPlayerIndex,
    resignedSlotId: parsed.resignedSlotId as PlayerSlotId | null,
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
    throw new Error("Hex requires exactly two distinct player slots.");
  }
  return Object.freeze([first, second]);
}

function findWinningPath(
  state: DeepReadonly<HexState>,
  playerIndex: 0 | 1,
): readonly number[] | null {
  const owner = state.players[playerIndex];
  const sources: number[] = [];
  for (let cell = 0; cell < HEX_CELL_COUNT; cell += 1) {
    const isSource =
      playerIndex === 0 ? rowOf(cell) === 0 : columnOf(cell) === 0;
    if (isSource && state.board[cell] === owner) sources.push(cell);
  }

  const parents = Array<number>(HEX_CELL_COUNT).fill(-2);
  const queue: number[] = [];
  for (const source of sources) {
    parents[source] = -1;
    queue.push(source);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head];
    if (cell === undefined) break;
    const reachedTarget =
      playerIndex === 0
        ? rowOf(cell) === HEX_BOARD_SIZE - 1
        : columnOf(cell) === HEX_BOARD_SIZE - 1;
    if (reachedTarget) {
      const reversedPath: number[] = [];
      let current = cell;
      while (current !== -1) {
        reversedPath.push(current);
        const parent = parents[current];
        if (parent === undefined || parent === -2) {
          throw new Error("Hex BFS parent invariant was violated.");
        }
        current = parent;
      }
      return Object.freeze(reversedPath.reverse());
    }

    for (const neighbor of neighborCells(cell)) {
      if (parents[neighbor] !== -2 || state.board[neighbor] !== owner) continue;
      parents[neighbor] = cell;
      queue.push(neighbor);
    }
  }
  return null;
}

function calculateOutcome(state: DeepReadonly<HexState>): HexOutcome | null {
  const bluePath = findWinningPath(state, 0);
  const redPath = findWinningPath(state, 1);
  if (bluePath !== null && redPath !== null) {
    throw new Error("Hex invariant violated: both players are connected.");
  }
  if (
    state.resignedSlotId !== null &&
    (bluePath !== null || redPath !== null)
  ) {
    throw new Error(
      "Hex invariant violated: resignation and connection coexist.",
    );
  }
  if (state.resignedSlotId !== null) {
    const winnerSlotId =
      state.resignedSlotId === state.players[0]
        ? state.players[1]
        : state.players[0];
    return parseOutcome({
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId,
      resignedSlotId: state.resignedSlotId,
    });
  }
  if (bluePath !== null) {
    return parseOutcome({
      type: "WIN",
      reason: "CONNECTION",
      winnerSlotId: state.players[0],
      winningPath: bluePath,
    });
  }
  if (redPath !== null) {
    return parseOutcome({
      type: "WIN",
      reason: "CONNECTION",
      winnerSlotId: state.players[1],
      winningPath: redPath,
    });
  }
  if (state.board.every((cell) => cell !== null)) {
    throw new Error("Hex invariant violated: a full board has no winner.");
  }
  return null;
}

export function createInitialState(
  context: InitialContext<HexConfig>,
): Initialized<HexState> {
  hexConfigSchema.parse(context.config);
  const players = requirePlayers(context.players);
  const state = parseState({
    players,
    board: Array<null>(HEX_CELL_COUNT).fill(null),
    nextPlayerIndex: 0,
    resignedSlotId: null,
  });
  return { state, rng: context.rng };
}

export function getOutcome(state: DeepReadonly<HexState>): HexOutcome | null {
  return calculateOutcome(parseState(state));
}

function reject(code: HexRuleErrorCode): Transition<HexState> {
  return { status: "rejected", code };
}

export function transition(
  context: TransitionContext<HexState, HexAction>,
): Transition<HexState> {
  const state = parseState(context.state);
  if (calculateOutcome(state) !== null) {
    return reject("MATCH_ALREADY_FINISHED");
  }

  const [bluePlayer, redPlayer] = state.players;
  if (context.actorSlotId !== bluePlayer && context.actorSlotId !== redPlayer) {
    return reject("NOT_A_PLAYER");
  }

  if (context.action.type === "RESIGN") {
    return {
      status: "accepted",
      state: parseState({ ...state, resignedSlotId: context.actorSlotId }),
      rng: context.rng,
    };
  }

  if (context.actorSlotId !== state.players[state.nextPlayerIndex]) {
    return reject("NOT_YOUR_TURN");
  }
  const cell = context.action.cell;
  if (!Number.isInteger(cell) || cell < 0 || cell >= HEX_CELL_COUNT) {
    return reject("CELL_OUT_OF_BOUNDS");
  }
  if (state.board[cell] !== null) {
    return reject("CELL_OCCUPIED");
  }

  const board = [...state.board];
  board[cell] = context.actorSlotId;
  return {
    status: "accepted",
    state: parseState({
      players: state.players,
      board,
      nextPlayerIndex: state.nextPlayerIndex === 0 ? 1 : 0,
      resignedSlotId: null,
    }),
    rng: context.rng,
  };
}

function freezeView(view: HexView): HexView {
  return Object.freeze({
    players: Object.freeze(
      view.players.map((player) => Object.freeze({ ...player })),
    ) as HexView["players"],
    board: Object.freeze([...view.board]) as HexBoard,
    nextTurnSlotId: view.nextTurnSlotId,
    outcome: view.outcome === null ? null : freezeOutcome(view.outcome),
    yourColor: view.yourColor,
  });
}

export function projectView(context: ViewContext<HexState>): HexView {
  const state = parseState(context.state);
  const outcome = calculateOutcome(state);
  const [bluePlayer, redPlayer] = state.players;
  const parsed = hexViewSchema.parse({
    players: [
      { slotId: bluePlayer, color: "BLUE" },
      { slotId: redPlayer, color: "RED" },
    ],
    board: state.board,
    nextTurnSlotId:
      outcome === null ? state.players[state.nextPlayerIndex] : null,
    outcome,
    yourColor:
      context.viewer.kind === "player"
        ? context.viewer.slotId === bluePlayer
          ? "BLUE"
          : context.viewer.slotId === redPlayer
            ? "RED"
            : null
        : null,
  }) as unknown as HexView;
  return freezeView(parsed);
}

export const hexDefinition = {
  manifest: hexManifest,
  configSchema: hexConfigSchema,
  actionSchema: hexActionSchema,
  createInitialState,
  transition,
  projectView,
  getOutcome,
} satisfies GameDefinition<HexConfig, HexState, HexAction, HexView, HexOutcome>;
