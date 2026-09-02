import { definePlayerSlotId } from "@online-game-hub/game-sdk";
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
  CHINESE_CHECKERS_CAMP_OPTIONS,
  CHINESE_CHECKERS_CELL_COUNT,
} from "../constants.js";
import {
  CHINESE_CHECKERS_CAMP_CELLS,
  adjacentCells,
  jumpLanding,
  oppositeCamp,
} from "../geometry.js";
import { chineseCheckersManifest } from "../manifest.js";
import type {
  ChineseCheckersAction,
  ChineseCheckersCamp,
  ChineseCheckersConfig,
  ChineseCheckersOutcome,
  ChineseCheckersPlayer,
  ChineseCheckersRankReason,
  ChineseCheckersRanking,
  ChineseCheckersRuleErrorCode,
  ChineseCheckersState,
  ChineseCheckersView,
} from "../types.js";

export type * from "../types.js";
export {
  CHINESE_CHECKERS_CAMP_OPTIONS,
  CHINESE_CHECKERS_CELL_COUNT,
} from "../constants.js";
export {
  CHINESE_CHECKERS_CAMP_CELLS,
  CHINESE_CHECKERS_CENTER_CELLS,
  CHINESE_CHECKERS_COORDINATES,
  adjacentCells,
  cellCoordinate,
  campForCell,
  oppositeCamp,
} from "../geometry.js";

const slotIdSchema = z.string().min(1);
const cellSchema = z
  .number()
  .int()
  .min(0)
  .max(CHINESE_CHECKERS_CELL_COUNT - 1);
const campSchema = z.enum(CHINESE_CHECKERS_CAMP_OPTIONS);
const playerSchema = z
  .object({ slotId: slotIdSchema, camp: campSchema })
  .strict();
const rankingSchema = z
  .object({
    slotId: slotIdSchema,
    rank: z.number().int().positive(),
    reason: z.enum(["FINISHED", "RESIGNATION", "BLOCKED", "LAST_REMAINING"]),
  })
  .strict();

export const chineseCheckersConfigSchema = z.null();
export const chineseCheckersActionSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("MOVE_PIECE"), from: cellSchema, to: cellSchema })
    .strict()
    .refine((action) => action.from !== action.to, "A move must change cells."),
  z.object({ type: z.literal("RESIGN") }).strict(),
]);
export const chineseCheckersRankingSchema = rankingSchema;
export const chineseCheckersOutcomeSchema = z
  .object({ type: z.literal("RANKING"), rankings: z.array(rankingSchema) })
  .strict();
const boardSchema = z
  .array(slotIdSchema.nullable())
  .length(CHINESE_CHECKERS_CELL_COUNT);
export const chineseCheckersStateSchema = z
  .object({
    players: z.array(playerSchema).min(2).max(6),
    board: boardSchema,
    nextPlayerIndex: z.number().int().min(0).max(5),
    rankings: z.array(rankingSchema),
    resignedSlotIds: z.array(slotIdSchema),
  })
  .strict()
  .superRefine((state, context) => {
    const slots = state.players.map((player) => player.slotId);
    if (new Set(slots).size !== slots.length) {
      context.addIssue({
        code: "custom",
        message: "Player slots must be unique.",
        path: ["players"],
      });
    }
    if (
      new Set(state.players.map((player) => player.camp)).size !==
      state.players.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Player camps must be unique.",
        path: ["players"],
      });
    }
    if (state.nextPlayerIndex >= state.players.length) {
      context.addIssue({
        code: "custom",
        message: "Next player index is outside the player list.",
        path: ["nextPlayerIndex"],
      });
    }
    for (const [cell, owner] of state.board.entries()) {
      if (owner !== null && !slots.includes(owner)) {
        context.addIssue({
          code: "custom",
          message: "Board owner is not a player.",
          path: ["board", cell],
        });
      }
    }
    const rankingSlots = state.rankings.map((entry) => entry.slotId);
    if (
      new Set(rankingSlots).size !== rankingSlots.length ||
      rankingSlots.some((slot) => !slots.includes(slot))
    ) {
      context.addIssue({
        code: "custom",
        message: "Rankings must reference players once.",
        path: ["rankings"],
      });
    }
    const resignedSlots = new Set(state.resignedSlotIds);
    if (
      resignedSlots.size !== state.resignedSlotIds.length ||
      state.resignedSlotIds.some((slot) => !slots.includes(slot))
    ) {
      context.addIssue({
        code: "custom",
        message: "Resigned slots must reference each player at most once.",
        path: ["resignedSlotIds"],
      });
    }
    for (const ranking of state.rankings) {
      const isResignation = ranking.reason === "RESIGNATION";
      if (isResignation !== resignedSlots.has(ranking.slotId)) {
        context.addIssue({
          code: "custom",
          message: "Ranking resignation reasons must match resigned players.",
          path: ["rankings"],
        });
        break;
      }
    }
    for (const [index, ranking] of state.rankings.entries()) {
      if (ranking.rank !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Ranking positions must be contiguous.",
          path: ["rankings", index, "rank"],
        });
      }
    }
    for (const player of state.players) {
      const count = state.board.filter((slot) => slot === player.slotId).length;
      if (count !== 6) {
        context.addIssue({
          code: "custom",
          message: "Each player must own six pieces.",
          path: ["board"],
        });
      }
    }
  });
const moveSchema = z.object({ from: cellSchema, to: cellSchema }).strict();
export const chineseCheckersViewSchema = z
  .object({
    players: z.array(playerSchema).min(2).max(6),
    board: boardSchema,
    nextTurnSlotId: slotIdSchema.nullable(),
    legalMoves: z.array(moveSchema),
    rankings: z.array(rankingSchema),
    outcome: chineseCheckersOutcomeSchema.nullable(),
    yourCamp: campSchema.nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const slots = view.players.map((player) => player.slotId);
    const camps = view.players.map((player) => player.camp);
    if (new Set(slots).size !== slots.length) {
      context.addIssue({
        code: "custom",
        message: "View player slots must be unique.",
        path: ["players"],
      });
    }
    if (new Set(camps).size !== camps.length) {
      context.addIssue({
        code: "custom",
        message: "View player camps must be unique.",
        path: ["players"],
      });
    }
    for (const [cell, owner] of view.board.entries()) {
      if (owner !== null && !slots.includes(owner)) {
        context.addIssue({
          code: "custom",
          message: "View board cells may only reference visible players.",
          path: ["board", cell],
        });
      }
    }
    for (const player of view.players) {
      if (view.board.filter((owner) => owner === player.slotId).length !== 6) {
        context.addIssue({
          code: "custom",
          message: "Each visible player must own six pieces.",
          path: ["board"],
        });
      }
    }
    if (view.nextTurnSlotId !== null && !slots.includes(view.nextTurnSlotId)) {
      context.addIssue({
        code: "custom",
        message: "The next turn must reference a visible player.",
        path: ["nextTurnSlotId"],
      });
    }
    const moveKeys = view.legalMoves.map((move) => `${move.from}:${move.to}`);
    if (new Set(moveKeys).size !== moveKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Legal moves must be unique.",
        path: ["legalMoves"],
      });
    }
    for (const [index, move] of view.legalMoves.entries()) {
      if (
        view.nextTurnSlotId === null ||
        view.board[move.from] !== view.nextTurnSlotId ||
        view.board[move.to] !== null ||
        !legalMove(view as unknown as ChineseCheckersState, move.from, move.to)
      ) {
        context.addIssue({
          code: "custom",
          message: "Legal moves must be valid for the next player.",
          path: ["legalMoves", index],
        });
      }
    }
    if (
      view.outcome === null &&
      (view.nextTurnSlotId === null || view.legalMoves.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "An active view must expose a turn and legal moves.",
        path: ["legalMoves"],
      });
    }
    if (
      view.outcome !== null &&
      (view.nextTurnSlotId !== null || view.legalMoves.length !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "A terminal view may not expose another move.",
        path: ["outcome"],
      });
    }
    if (view.yourCamp !== null && !camps.includes(view.yourCamp)) {
      context.addIssue({
        code: "custom",
        message: "The viewer camp must reference a visible player.",
        path: ["yourCamp"],
      });
    }
  });

function freezePlayer(player: ChineseCheckersPlayer): ChineseCheckersPlayer {
  return Object.freeze({ slotId: player.slotId, camp: player.camp });
}
function freezeRanking(
  ranking: ChineseCheckersRanking,
): ChineseCheckersRanking {
  return Object.freeze({ ...ranking });
}
function freezeState(input: ChineseCheckersState): ChineseCheckersState {
  return Object.freeze({
    players: Object.freeze(input.players.map(freezePlayer)),
    board: Object.freeze([...input.board]),
    nextPlayerIndex: input.nextPlayerIndex,
    rankings: Object.freeze(input.rankings.map(freezeRanking)),
    resignedSlotIds: Object.freeze([...input.resignedSlotIds]),
  });
}
function parseState(input: unknown): ChineseCheckersState {
  const parsed = chineseCheckersStateSchema.parse(input);
  return freezeState({
    ...parsed,
    players: parsed.players.map((player) => ({
      slotId: definePlayerSlotId(player.slotId),
      camp: player.camp,
    })),
    board: parsed.board.map((slotId) =>
      slotId === null ? null : definePlayerSlotId(slotId),
    ),
    rankings: parsed.rankings.map((ranking) => ({
      ...ranking,
      slotId: definePlayerSlotId(ranking.slotId),
    })),
    resignedSlotIds: parsed.resignedSlotIds.map(definePlayerSlotId),
  });
}
function parseOutcome(input: unknown): ChineseCheckersOutcome {
  const parsed = chineseCheckersOutcomeSchema.parse(input);
  return Object.freeze({
    rankings: Object.freeze(
      parsed.rankings.map((ranking) =>
        freezeRanking({
          ...ranking,
          slotId: definePlayerSlotId(ranking.slotId),
        }),
      ),
    ),
    type: "RANKING",
  });
}
function requireAssignments(
  players: readonly PlayerSlotId[],
  assignments: readonly string[] | undefined,
): readonly ChineseCheckersPlayer[] {
  if (
    players.length < 2 ||
    players.length > 6 ||
    new Set(players).size !== players.length ||
    assignments === undefined ||
    assignments.length !== players.length
  ) {
    throw new Error(
      "Chinese Checkers requires 2 to 6 distinct players with one camp assignment per player.",
    );
  }
  const result = players.map((slotId, index) => {
    const camp = assignments[index];
    if (!campSchema.safeParse(camp).success)
      throw new Error("Invalid camp assignment.");
    return { slotId, camp: camp as ChineseCheckersCamp };
  });
  if (new Set(result.map((player) => player.camp)).size !== result.length) {
    throw new Error("Chinese Checkers camps must be unique.");
  }
  return Object.freeze(result);
}
function initialBoard(
  players: readonly ChineseCheckersPlayer[],
): readonly (PlayerSlotId | null)[] {
  const board: (PlayerSlotId | null)[] = Array(
    CHINESE_CHECKERS_CELL_COUNT,
  ).fill(null);
  for (const player of players) {
    for (const cell of CHINESE_CHECKERS_CAMP_CELLS[player.camp])
      board[cell] = player.slotId;
  }
  return board;
}
function isRanked(
  state: DeepReadonly<ChineseCheckersState>,
  slotId: PlayerSlotId,
): boolean {
  return (
    state.rankings.some((entry) => entry.slotId === slotId) ||
    state.resignedSlotIds.includes(slotId)
  );
}
function targetFilled(
  state: DeepReadonly<ChineseCheckersState>,
  player: ChineseCheckersPlayer,
): boolean {
  return CHINESE_CHECKERS_CAMP_CELLS[oppositeCamp(player.camp)].every(
    (cell) => state.board[cell] === player.slotId,
  );
}
function jumpReachable(
  state: DeepReadonly<ChineseCheckersState>,
  from: number,
  to: number,
): boolean {
  // During a multi-jump the moving piece has vacated its origin; keep the
  // board immutable while treating that one cell as empty for reachability.
  const occupied = (cell: number): boolean =>
    cell !== from && state.board[cell] !== null;
  const visited = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (let direction = 0; direction < 6; direction += 1) {
      const jump = jumpLanding(current, direction);
      if (jump === null || !occupied(jump.over) || occupied(jump.landing))
        continue;
      if (jump.landing === to) return true;
      if (!visited.has(jump.landing)) {
        visited.add(jump.landing);
        queue.push(jump.landing);
      }
    }
  }
  return false;
}
function legalMove(
  state: DeepReadonly<ChineseCheckersState>,
  from: number,
  to: number,
): boolean {
  if (from === to || state.board[from] === null || state.board[to] !== null)
    return false;
  if (adjacentCells(from).includes(to)) return true;
  return jumpReachable(state, from, to);
}
function legalMovesFor(
  state: DeepReadonly<ChineseCheckersState>,
  slotId: PlayerSlotId,
): readonly { from: number; to: number }[] {
  const moves: { from: number; to: number }[] = [];
  for (let from = 0; from < state.board.length; from += 1) {
    if (state.board[from] !== slotId) continue;
    for (let to = 0; to < state.board.length; to += 1) {
      if (legalMove(state, from, to)) moves.push({ from, to });
    }
  }
  return moves;
}
function nextEligibleIndex(
  state: ChineseCheckersState,
  start: number,
): number | null {
  for (let offset = 0; offset < state.players.length; offset += 1) {
    const index = (start + offset) % state.players.length;
    const player = state.players[index];
    if (player === undefined || isRanked(state, player.slotId)) continue;
    if (legalMovesFor(state, player.slotId).length > 0) return index;
  }
  return null;
}
function appendRanking(
  state: ChineseCheckersState,
  player: ChineseCheckersPlayer,
  reason: ChineseCheckersRankReason,
): ChineseCheckersRanking[] {
  return [
    ...state.rankings,
    { slotId: player.slotId, rank: state.rankings.length + 1, reason },
  ];
}
function finishRemaining(
  state: ChineseCheckersState,
  rankings: ChineseCheckersRanking[],
): ChineseCheckersRanking[] {
  const ranked = new Set(rankings.map((entry) => entry.slotId));
  const resigned = new Set(state.resignedSlotIds);
  const remaining = state.players.filter(
    (player) => !ranked.has(player.slotId) && !resigned.has(player.slotId),
  );
  for (const player of remaining) {
    rankings.push({
      slotId: player.slotId,
      rank: rankings.length + 1,
      reason: "LAST_REMAINING",
    });
  }
  for (const slotId of state.resignedSlotIds) {
    rankings.push({ slotId, rank: rankings.length + 1, reason: "RESIGNATION" });
  }
  return rankings;
}
function advanceTurn(
  state: DeepReadonly<ChineseCheckersState>,
  rankings: ChineseCheckersRanking[],
  start: number,
): {
  readonly rankings: ChineseCheckersRanking[];
  readonly nextPlayerIndex: number;
} {
  const active = state.players.filter(
    (player) =>
      !rankings.some((entry) => entry.slotId === player.slotId) &&
      !state.resignedSlotIds.includes(player.slotId),
  );
  if (active.length <= 1) {
    const finished = finishRemaining(state, rankings);
    return { rankings: finished, nextPlayerIndex: 0 };
  }
  const next = nextEligibleIndex({ ...state, rankings }, start);
  if (next !== null) return { rankings, nextPlayerIndex: next };
  const blocked = new Set(active.map((player) => player.slotId));
  for (let offset = 0; offset < state.players.length; offset += 1) {
    const index = (start + offset) % state.players.length;
    const player = state.players[index];
    if (player === undefined || !blocked.has(player.slotId)) continue;
    rankings.push({
      slotId: player.slotId,
      rank: rankings.length + 1,
      reason: "BLOCKED",
    });
  }
  return { rankings: finishRemaining(state, rankings), nextPlayerIndex: 0 };
}
function outcomeFor(
  state: DeepReadonly<ChineseCheckersState>,
): ChineseCheckersOutcome | null {
  if (state.rankings.length === state.players.length)
    return parseOutcome({ type: "RANKING", rankings: state.rankings });
  return null;
}

export function createInitialState(
  context: InitialContext<ChineseCheckersConfig>,
): Initialized<ChineseCheckersState> {
  chineseCheckersConfigSchema.parse(context.config);
  const players = requireAssignments(
    context.players,
    context.playerAssignments,
  );
  const baseState = parseState({
    players,
    board: initialBoard(players),
    nextPlayerIndex: 0,
    rankings: [],
    resignedSlotIds: [],
  });
  // Initialization must also resolve a blocked first turn deterministically.
  const advanced = advanceTurn(baseState, [], 0);
  const state = freezeState({
    ...baseState,
    rankings: advanced.rankings,
    nextPlayerIndex: advanced.nextPlayerIndex,
  });
  return { state, rng: context.rng };
}
export function getOutcome(
  state: DeepReadonly<ChineseCheckersState>,
): ChineseCheckersOutcome | null {
  return outcomeFor(parseState(state));
}
function reject(
  code: ChineseCheckersRuleErrorCode,
): Transition<ChineseCheckersState> {
  return { status: "rejected", code };
}
export function transition(
  context: TransitionContext<ChineseCheckersState, ChineseCheckersAction>,
): Transition<ChineseCheckersState> {
  const state = parseState(context.state);
  const outcome = outcomeFor(state);
  if (outcome !== null) return reject("MATCH_ALREADY_FINISHED");
  const player = state.players.find(
    (candidate) => candidate.slotId === context.actorSlotId,
  );
  if (player === undefined) return reject("NOT_A_PLAYER");
  if (context.action.type === "RESIGN") {
    if (isRanked(state, context.actorSlotId))
      return reject("PLAYER_ALREADY_RANKED");
    const resignedSlotIds = [...state.resignedSlotIds, context.actorSlotId];
    const rankings = [...state.rankings];
    const advanced = advanceTurn(
      { ...state, resignedSlotIds, rankings },
      rankings,
      state.players[state.nextPlayerIndex]?.slotId === context.actorSlotId
        ? (state.nextPlayerIndex + 1) % state.players.length
        : state.nextPlayerIndex,
    );
    return {
      status: "accepted",
      state: freezeState({
        ...state,
        resignedSlotIds,
        rankings: advanced.rankings,
        nextPlayerIndex: advanced.nextPlayerIndex,
      }),
      rng: context.rng,
    };
  }
  if (isRanked(state, context.actorSlotId))
    return reject("PLAYER_ALREADY_RANKED");
  if (state.players[state.nextPlayerIndex]?.slotId !== context.actorSlotId)
    return reject("NOT_YOUR_TURN");
  const { from, to } = context.action;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from >= CHINESE_CHECKERS_CELL_COUNT ||
    to < 0 ||
    to >= CHINESE_CHECKERS_CELL_COUNT
  )
    return reject("CELL_OUT_OF_BOUNDS");
  if (state.board[from] !== context.actorSlotId)
    return reject("SOURCE_NOT_OWNED");
  if (state.board[to] !== null) return reject("DESTINATION_OCCUPIED");
  if (!legalMove(state, from, to)) return reject("ILLEGAL_MOVE");
  const board = [...state.board];
  board[from] = null;
  board[to] = context.actorSlotId;
  let rankings = [...state.rankings];
  const moved = { ...state, board };
  if (targetFilled(moved, player))
    rankings = appendRanking(state, player, "FINISHED");
  const provisional = { ...moved, rankings };
  const advanced = advanceTurn(
    provisional,
    rankings,
    (state.nextPlayerIndex + 1) % state.players.length,
  );
  return {
    status: "accepted",
    state: freezeState({
      ...state,
      board,
      rankings: advanced.rankings,
      nextPlayerIndex: advanced.nextPlayerIndex,
    }),
    rng: context.rng,
  };
}
function freezeView(view: ChineseCheckersView): ChineseCheckersView {
  return Object.freeze({
    players: Object.freeze(view.players.map(freezePlayer)),
    board: Object.freeze([...view.board]),
    nextTurnSlotId: view.nextTurnSlotId,
    legalMoves: Object.freeze(
      view.legalMoves.map((move) => Object.freeze({ ...move })),
    ),
    rankings: Object.freeze(view.rankings.map(freezeRanking)),
    outcome: view.outcome === null ? null : parseOutcome(view.outcome),
    yourCamp: view.yourCamp,
  });
}
export function projectView(
  context: ViewContext<ChineseCheckersState>,
): ChineseCheckersView {
  const state = parseState(context.state);
  const outcome = outcomeFor(state);
  const next =
    outcome === null ? state.players[state.nextPlayerIndex] : undefined;
  const viewerSlotId =
    context.viewer.kind === "player" ? context.viewer.slotId : null;
  const parsed = chineseCheckersViewSchema.parse({
    players: state.players,
    board: state.board,
    nextTurnSlotId: next?.slotId ?? null,
    legalMoves: next === undefined ? [] : legalMovesFor(state, next.slotId),
    rankings: state.rankings,
    outcome,
    yourCamp:
      viewerSlotId === null
        ? null
        : (state.players.find((player) => player.slotId === viewerSlotId)
            ?.camp ?? null),
  }) as unknown as ChineseCheckersView;
  return freezeView(parsed);
}

export const chineseCheckersDefinition = {
  manifest: chineseCheckersManifest,
  configSchema: chineseCheckersConfigSchema,
  actionSchema: chineseCheckersActionSchema,
  createInitialState,
  transition,
  projectView,
  getOutcome,
} satisfies GameDefinition<
  ChineseCheckersConfig,
  ChineseCheckersState,
  ChineseCheckersAction,
  ChineseCheckersView,
  ChineseCheckersOutcome
>;
