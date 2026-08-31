import {
  createRng,
  definePlayerSlotId,
  isJsonValue,
} from "@online-game-hub/game-sdk";
import type { PlayerSlotId, RngState, Viewer } from "@online-game-hub/game-sdk";
import { describe, expect, it } from "vitest";

import {
  REVERSI_CELL_COUNT,
  createInitialState,
  getOutcome,
  projectView,
  reversiActionSchema,
  reversiConfigSchema,
  reversiOutcomeSchema,
  reversiStateSchema,
  reversiViewSchema,
  transition,
} from "../src/core/index.js";
import type { ReversiAction, ReversiState } from "../src/core/index.js";

const playerBlack = definePlayerSlotId("player-black");
const playerWhite = definePlayerSlotId("player-white");
const players = Object.freeze([playerBlack, playerWhite] as const);

function initialize(seed = "reversi-seed"): {
  state: ReversiState;
  rng: RngState;
} {
  return createInitialState({ config: null, players, rng: createRng(seed) });
}

function acceptedAction(
  state: ReversiState,
  rng: RngState,
  actorSlotId: PlayerSlotId,
  cell: number,
): { state: ReversiState; rng: RngState } {
  const result = transition({
    state,
    rng,
    actorSlotId,
    action: { type: "PLACE_DISC", cell },
  });
  if (result.status !== "accepted") {
    throw new Error(`Expected PLACE_DISC(${cell}) to be accepted.`);
  }
  return result;
}

function stateWithBoard(
  blackCells: readonly number[],
  whiteCells: readonly number[],
  nextPlayerIndex: 0 | 1 = 0,
): ReversiState {
  const board = Array<PlayerSlotId | null>(REVERSI_CELL_COUNT).fill(null);
  for (const cell of blackCells) board[cell] = playerBlack;
  for (const cell of whiteCells) board[cell] = playerWhite;
  return reversiStateSchema.parse({
    players,
    board,
    nextPlayerIndex,
  }) as unknown as ReversiState;
}

function play(
  sequence: readonly number[],
  seed = "reversi-play",
): { state: ReversiState; rng: RngState } {
  let current = initialize(seed);
  for (const cell of sequence) {
    const actor = current.state.players[current.state.nextPlayerIndex];
    current = acceptedAction(current.state, current.rng, actor, cell);
  }
  return current;
}

describe("Config, Action, and initialization", () => {
  it("accepts only null Config and a strict minimal PLACE_DISC intent", () => {
    expect(reversiConfigSchema.parse(null)).toBeNull();
    for (const invalid of [{}, [], false, 0, "null"]) {
      expect(reversiConfigSchema.safeParse(invalid).success).toBe(false);
    }

    expect(
      reversiActionSchema.safeParse({ type: "PLACE_DISC", cell: 63 }).success,
    ).toBe(true);
    for (const invalid of [
      { type: "PLACE_DISC", cell: -1 },
      { type: "PLACE_DISC", cell: 64 },
      { type: "PLACE_DISC", cell: 1.5 },
      { type: "PLACE_DISC", cell: 19, actorSlotId: playerBlack },
      { type: "PLACE_DISC", cell: 19, flips: [27] },
      { type: "PLACE_DISC", cell: 19, state: {} },
      { type: "PLACE_DISC", cell: 19, outcome: {} },
      { type: "PLACE_DISC", cell: 19, revision: 0 },
      { type: "PASS" },
    ]) {
      expect(reversiActionSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("initializes the exact immutable four-disc position with Black first and zero RNG use", () => {
    const rng = Object.freeze(createRng("reversi-init"));
    const first = createInitialState({ config: null, players, rng });
    const second = createInitialState({ config: null, players, rng });
    expect(first).toEqual(second);
    expect(first.state.players).toEqual(players);
    expect(first.state.nextPlayerIndex).toBe(0);
    expect(first.state.board.filter((cell) => cell !== null)).toHaveLength(4);
    expect(first.state.board[27]).toBe(playerWhite);
    expect(first.state.board[36]).toBe(playerWhite);
    expect(first.state.board[28]).toBe(playerBlack);
    expect(first.state.board[35]).toBe(playerBlack);
    expect(
      projectView({ state: first.state, viewer: { kind: "spectator" } }),
    ).toMatchObject({
      legalMoves: [19, 26, 37, 44],
      discCounts: { BLACK: 2, WHITE: 2 },
      nextTurnSlotId: playerBlack,
    });
    expect(first.rng).toBe(rng);
    expect(first.rng.cursor).toBe(0);
    expect(Object.isFrozen(first.state)).toBe(true);
    expect(Object.isFrozen(first.state.board)).toBe(true);
    expect(getOutcome(first.state)).toBeNull();
  });

  it("requires exactly two distinct stable slots", () => {
    const rng = createRng("reversi-players");
    expect(() =>
      createInitialState({ config: null, players: [playerBlack], rng }),
    ).toThrow(/exactly two distinct/u);
    expect(() =>
      createInitialState({
        config: null,
        players: [playerBlack, playerBlack],
        rng,
      }),
    ).toThrow(/exactly two distinct/u);
  });
});

describe("captures and legality", () => {
  it("captures one line from the standard opening and alternates the turn", () => {
    const initial = initialize("reversi-opening");
    const result = acceptedAction(initial.state, initial.rng, playerBlack, 19);
    expect(result.state.board[19]).toBe(playerBlack);
    expect(result.state.board[27]).toBe(playerBlack);
    expect(result.state.nextPlayerIndex).toBe(1);
    expect(result.rng.cursor).toBe(0);
  });

  it("captures all eight legal directions in one accepted transition", () => {
    const adjacentWhite = [18, 19, 20, 26, 28, 34, 35, 36];
    const enclosingBlack = [9, 11, 13, 25, 29, 41, 43, 45];
    const state = stateWithBoard(enclosingBlack, adjacentWhite);
    const result = acceptedAction(
      state,
      createRng("eight-lines"),
      playerBlack,
      27,
    );
    expect(result.state.board[27]).toBe(playerBlack);
    for (const cell of adjacentWhite) {
      expect(result.state.board[cell]).toBe(playerBlack);
    }
    expect(
      result.state.board.filter((owner) => owner === playerBlack),
    ).toHaveLength(17);
    expect(result.rng.cursor).toBe(0);
  });

  it("captures from a corner but never wraps across rows", () => {
    const corner = stateWithBoard([2, 16, 18], [1, 8, 9]);
    const captured = acceptedAction(
      corner,
      createRng("corner"),
      playerBlack,
      0,
    );
    expect(captured.state.board.slice(0, 3)).toEqual([
      playerBlack,
      playerBlack,
      playerBlack,
    ]);
    expect(captured.state.board[8]).toBe(playerBlack);
    expect(captured.state.board[9]).toBe(playerBlack);

    const wrapped = stateWithBoard([9, 20], [8, 19]);
    expect(
      transition({
        state: wrapped,
        actorSlotId: playerBlack,
        action: { type: "PLACE_DISC", cell: 7 },
        rng: createRng("no-wrap"),
      }),
    ).toEqual({ status: "rejected", code: "NO_DISC_CAPTURED" });
  });

  it("uses the fixed rejection order and leaves rejected inputs without candidate State or RNG", () => {
    const initial = initialize("reversi-rejections");
    const stranger = definePlayerSlotId("stranger");
    const cases = [
      [stranger, { type: "PLACE_DISC", cell: 19 }, "NOT_A_PLAYER"],
      [playerWhite, { type: "PLACE_DISC", cell: -1 }, "NOT_YOUR_TURN"],
      [playerBlack, { type: "PLACE_DISC", cell: -1 }, "CELL_OUT_OF_BOUNDS"],
      [playerBlack, { type: "PLACE_DISC", cell: 64 }, "CELL_OUT_OF_BOUNDS"],
      [playerBlack, { type: "PLACE_DISC", cell: 28 }, "CELL_OCCUPIED"],
      [playerBlack, { type: "PLACE_DISC", cell: 0 }, "NO_DISC_CAPTURED"],
    ] as const;
    for (const [actorSlotId, action, code] of cases) {
      const beforeState = JSON.stringify(initial.state);
      const result = transition({
        state: initial.state,
        actorSlotId,
        action: action as ReversiAction,
        rng: initial.rng,
      });
      expect(result).toEqual({ status: "rejected", code });
      expect("state" in result).toBe(false);
      expect("rng" in result).toBe(false);
      expect(JSON.stringify(initial.state)).toBe(beforeState);
      expect(initial.rng.cursor).toBe(0);
    }
  });
});

describe("forced skips and terminal outcomes", () => {
  it("keeps the same slot active when the opponent has no move and does not invent an Action", () => {
    const blackCells = Array.from({ length: 64 }, (_, cell) => cell).filter(
      (cell) => ![0, 1, 9, 10].includes(cell),
    );
    const state = stateWithBoard(blackCells, [1, 10]);
    const first = acceptedAction(
      state,
      createRng("forced-skip"),
      playerBlack,
      0,
    );
    expect(first.state.nextPlayerIndex).toBe(0);
    expect(getOutcome(first.state)).toBeNull();
    expect(
      projectView({ state: first.state, viewer: { kind: "spectator" } }),
    ).toMatchObject({
      nextTurnSlotId: playerBlack,
      legalMoves: [9],
      discCounts: { BLACK: 62, WHITE: 1 },
    });
    const terminal = acceptedAction(first.state, first.rng, playerBlack, 9);
    expect(getOutcome(terminal.state)).toEqual({
      type: "WIN",
      winnerSlotId: playerBlack,
      discCounts: { BLACK: 64, WHITE: 0 },
    });
  });

  it("ends immediately when both players have no move even with 61 empty cells", () => {
    const state = stateWithBoard([0], [1]);
    const terminal = acceptedAction(
      state,
      createRng("non-full-terminal"),
      playerBlack,
      2,
    );
    expect(terminal.state.board.filter((cell) => cell === null)).toHaveLength(
      61,
    );
    expect(getOutcome(terminal.state)).toEqual({
      type: "WIN",
      winnerSlotId: playerBlack,
      discCounts: { BLACK: 3, WHITE: 0 },
    });
    expect(
      projectView({ state: terminal.state, viewer: { kind: "spectator" } }),
    ).toMatchObject({
      nextTurnSlotId: null,
      legalMoves: [],
      outcome: { type: "WIN" },
    });
  });

  it("scores full-board Black wins, White wins, and draws", () => {
    const blackWin = stateWithBoard(
      Array.from({ length: 40 }, (_, cell) => cell),
      Array.from({ length: 24 }, (_, index) => index + 40),
    );
    const whiteWin = stateWithBoard(
      Array.from({ length: 24 }, (_, cell) => cell),
      Array.from({ length: 40 }, (_, index) => index + 24),
    );
    const draw = stateWithBoard(
      Array.from({ length: 32 }, (_, cell) => cell),
      Array.from({ length: 32 }, (_, index) => index + 32),
    );
    expect(getOutcome(blackWin)).toEqual({
      type: "WIN",
      winnerSlotId: playerBlack,
      discCounts: { BLACK: 40, WHITE: 24 },
    });
    expect(getOutcome(whiteWin)).toEqual({
      type: "WIN",
      winnerSlotId: playerWhite,
      discCounts: { BLACK: 24, WHITE: 40 },
    });
    expect(getOutcome(draw)).toEqual({
      type: "DRAW",
      discCounts: { BLACK: 32, WHITE: 32 },
    });
  });

  it("rejects every Action after a non-full terminal state before checking actor", () => {
    const terminal = acceptedAction(
      stateWithBoard([0], [1]),
      createRng("terminal-reject"),
      playerBlack,
      2,
    );
    expect(
      transition({
        state: terminal.state,
        actorSlotId: definePlayerSlotId("terminal-stranger"),
        action: { type: "PLACE_DISC", cell: 3 },
        rng: terminal.rng,
      }),
    ).toEqual({ status: "rejected", code: "MATCH_ALREADY_FINISHED" });
  });
});

describe("immutability, serialization, projection, and determinism", () => {
  it("does not mutate State, Action, Config, or RNG during an accepted transition", () => {
    const config = null;
    const rng = Object.freeze(createRng("reversi-immutable"));
    const initial = createInitialState({ config, players, rng });
    const action = Object.freeze({
      type: "PLACE_DISC",
      cell: 19,
    } as const satisfies ReversiAction);
    const before = JSON.parse(JSON.stringify(initial)) as unknown;
    const result = transition({
      state: initial.state,
      actorSlotId: playerBlack,
      action,
      rng,
    });
    expect(result.status).toBe("accepted");
    expect(initial).toEqual(before);
    expect(action).toEqual({ type: "PLACE_DISC", cell: 19 });
    expect(config).toBeNull();
    expect(rng.cursor).toBe(0);
    if (result.status !== "accepted") return;
    expect(result.state).not.toBe(initial.state);
    expect(result.state.board).not.toBe(initial.state.board);
    expect(result.rng).toBe(rng);
  });

  it("keeps Config, State, Action, View, and Outcome JSON-safe", () => {
    const terminal = play([37, 29, 21, 30, 23, 44, 19, 45, 53, 34, 33]);
    const action: ReversiAction = { type: "PLACE_DISC", cell: 37 };
    const outcome = getOutcome(terminal.state);
    const view = projectView({
      state: terminal.state,
      viewer: { kind: "player", slotId: playerBlack },
    });
    expect(reversiStateSchema.safeParse(terminal.state).success).toBe(true);
    expect(reversiActionSchema.safeParse(action).success).toBe(true);
    expect(reversiViewSchema.safeParse(view).success).toBe(true);
    expect(reversiOutcomeSchema.safeParse(outcome).success).toBe(true);
    for (const value of [null, terminal.state, action, view, outcome]) {
      expect(isJsonValue(value)).toBe(true);
      expect(JSON.parse(JSON.stringify(value)) as unknown).toEqual(value);
    }
  });

  it("projects fresh public Views for both players and spectators without Core-only fields", () => {
    const current = play([19, 18, 17]);
    const viewers: readonly Viewer[] = [
      { kind: "player", slotId: playerBlack },
      { kind: "player", slotId: playerWhite },
      { kind: "spectator" },
    ];
    const views = viewers.map((viewer) =>
      projectView({ state: current.state, viewer }),
    );
    expect(views.map((view) => view.yourDisc)).toEqual([
      "BLACK",
      "WHITE",
      null,
    ]);
    expect({ ...views[0], yourDisc: null }).toEqual(views[2]);
    expect({ ...views[1], yourDisc: null }).toEqual(views[2]);
    expect(views[0]).not.toBe(current.state);
    expect(views[0]?.board).not.toBe(current.state.board);
    expect(views[0]).not.toHaveProperty("nextPlayerIndex");
    expect(views[0]).not.toHaveProperty("rng");
    expect(JSON.stringify(views)).not.toContain("reversi-play");
  });

  it("repeats deeply equal State, View, Outcome, and zero RNG cursor", () => {
    const sequence = [37, 29, 21, 30, 23, 44, 19, 45, 53, 34, 33];
    const first = play(sequence, "reversi-repeatable");
    const second = play(sequence, "reversi-repeatable");
    expect(first).toEqual(second);
    expect(getOutcome(first.state)).toEqual(getOutcome(second.state));
    expect(
      projectView({ state: first.state, viewer: { kind: "spectator" } }),
    ).toEqual(
      projectView({ state: second.state, viewer: { kind: "spectator" } }),
    );
    expect(first.rng.cursor).toBe(0);
    expect(getOutcome(first.state)).toEqual({
      type: "WIN",
      winnerSlotId: playerBlack,
      discCounts: { BLACK: 15, WHITE: 0 },
    });
  });
});
