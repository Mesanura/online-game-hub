import {
  createRng,
  definePlayerSlotId,
  isJsonValue,
} from "@online-game-hub/game-sdk";
import type { PlayerSlotId, RngState, Viewer } from "@online-game-hub/game-sdk";
import { describe, expect, it } from "vitest";

import {
  createInitialState,
  getOutcome,
  projectView,
  ticTacToeActionSchema,
  ticTacToeConfigSchema,
  transition,
} from "../src/core/index.js";
import type {
  TicTacToeAction,
  TicTacToeCellIndex,
  TicTacToeOutcome,
  TicTacToeState,
} from "../src/core/index.js";

const playerX = definePlayerSlotId("player-x");
const playerO = definePlayerSlotId("player-o");
const players = Object.freeze([playerX, playerO]) satisfies readonly [
  PlayerSlotId,
  PlayerSlotId,
];

function initialize(seed = "tic-tac-toe-seed"): {
  state: TicTacToeState;
  rng: RngState;
} {
  return createInitialState({
    config: null,
    players,
    rng: createRng(seed),
  });
}

function acceptedMove(
  state: TicTacToeState,
  rng: RngState,
  actorSlotId: PlayerSlotId,
  cell: TicTacToeCellIndex,
): { state: TicTacToeState; rng: RngState } {
  const result = transition({
    state,
    actorSlotId,
    action: { type: "PLACE_MARK", cell },
    rng,
  });
  expect(result.status).toBe("accepted");
  if (result.status !== "accepted") {
    throw new Error("Expected test move to be accepted.");
  }
  return result;
}

function play(
  cells: readonly TicTacToeCellIndex[],
  seed = "tic-tac-toe-seed",
): { state: TicTacToeState; rng: RngState } {
  let current = initialize(seed);
  for (const [index, cell] of cells.entries()) {
    current = acceptedMove(
      current.state,
      current.rng,
      index % 2 === 0 ? playerX : playerO,
      cell,
    );
  }
  return current;
}

describe("schemas and initialization", () => {
  it("accepts only null config and strict PLACE_MARK intent", () => {
    expect(ticTacToeConfigSchema.safeParse(null).success).toBe(true);
    expect(ticTacToeConfigSchema.safeParse({}).success).toBe(false);
    expect(
      ticTacToeActionSchema.safeParse({ type: "PLACE_MARK", cell: 8 }).success,
    ).toBe(true);
    expect(
      ticTacToeActionSchema.safeParse({ type: "PLACE_MARK", cell: 9 }).success,
    ).toBe(false);
    expect(
      ticTacToeActionSchema.safeParse({
        type: "PLACE_MARK",
        cell: 0,
        actorSlotId: playerO,
      }).success,
    ).toBe(false);
  });

  it("initializes deterministically without consuming RNG", () => {
    const first = initialize("same-seed");
    const second = initialize("same-seed");
    expect(first).toEqual(second);
    expect(first.state.board).toEqual(Array<null>(9).fill(null));
    expect(first.state.players).toEqual(players);
    expect(first.state.nextPlayerIndex).toBe(0);
    expect(first.rng.cursor).toBe(0);
    expect(getOutcome(first.state)).toBeNull();
  });

  it("requires exactly two distinct slots", () => {
    const rng = createRng("player-count");
    expect(() =>
      createInitialState({ config: null, players: [playerX], rng }),
    ).toThrow(/exactly two distinct/u);
    expect(() =>
      createInitialState({
        config: null,
        players: [playerX, playerX],
        rng,
      }),
    ).toThrow(/exactly two distinct/u);
  });
});

describe("transitions", () => {
  it("accepts legal moves, alternates turns, and leaves inputs immutable", () => {
    const initial = initialize();
    const action = Object.freeze({
      type: "PLACE_MARK",
      cell: 4,
    } as const satisfies TicTacToeAction);
    const before = JSON.parse(JSON.stringify(initial)) as unknown;
    const result = transition({
      state: initial.state,
      actorSlotId: playerX,
      action,
      rng: initial.rng,
    });

    expect(result.status).toBe("accepted");
    expect(initial).toEqual(before);
    expect(action).toEqual({ type: "PLACE_MARK", cell: 4 });
    if (result.status === "accepted") {
      expect(result.state.board[4]).toBe(playerX);
      expect(result.state.nextPlayerIndex).toBe(1);
      expect(result.rng).toBe(initial.rng);
      expect(result.rng.cursor).toBe(0);
    }
  });

  it("rejects non-player, wrong-turn, out-of-bounds, and occupied moves", () => {
    const initial = initialize();
    const stranger = definePlayerSlotId("stranger");
    const cases = [
      {
        actorSlotId: stranger,
        action: { type: "PLACE_MARK", cell: 0 },
        code: "NOT_A_PLAYER",
      },
      {
        actorSlotId: playerO,
        action: { type: "PLACE_MARK", cell: 0 },
        code: "NOT_YOUR_TURN",
      },
      {
        actorSlotId: playerX,
        action: { type: "PLACE_MARK", cell: 9 },
        code: "CELL_OUT_OF_BOUNDS",
      },
    ] as const;

    for (const candidate of cases) {
      const result = transition({
        state: initial.state,
        actorSlotId: candidate.actorSlotId,
        action: candidate.action as unknown as TicTacToeAction,
        rng: initial.rng,
      });
      expect(result).toEqual({ status: "rejected", code: candidate.code });
      expect(initial.rng.cursor).toBe(0);
    }

    const afterX = acceptedMove(initial.state, initial.rng, playerX, 0);
    const occupied = transition({
      state: afterX.state,
      actorSlotId: playerO,
      action: { type: "PLACE_MARK", cell: 0 },
      rng: afterX.rng,
    });
    expect(occupied).toEqual({ status: "rejected", code: "CELL_OCCUPIED" });
  });

  it("does not expose candidate state or advance RNG on rejection", () => {
    const initial = initialize();
    const result = transition({
      state: initial.state,
      actorSlotId: playerO,
      action: { type: "PLACE_MARK", cell: 0 },
      rng: initial.rng,
    });
    expect(result).toEqual({ status: "rejected", code: "NOT_YOUR_TURN" });
    expect("state" in result).toBe(false);
    expect("rng" in result).toBe(false);
    expect(initial.rng.cursor).toBe(0);
    expect(initial.state.board).toEqual(Array<null>(9).fill(null));
  });
});

describe("outcomes", () => {
  const winningLines = [
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

  it.each(winningLines.map((line) => ({ line })))(
    "detects winning line $line",
    ({ line }) => {
      const selectedLine: readonly TicTacToeCellIndex[] = line;
      const fillers = ([0, 1, 2, 3, 4, 5, 6, 7, 8] as const).filter(
        (cell) => !selectedLine.includes(cell),
      );
      const state = play([
        line[0],
        fillers[0] as TicTacToeCellIndex,
        line[1],
        fillers[1] as TicTacToeCellIndex,
        line[2],
      ]).state;
      expect(getOutcome(state)).toEqual({
        type: "WIN",
        winnerSlotId: playerX,
        winningCells: line,
      });
    },
  );

  it("detects a draw", () => {
    const { state } = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(getOutcome(state)).toEqual({ type: "DRAW" });
  });

  it("rejects every action after a win or draw", () => {
    for (const state of [
      play([0, 3, 1, 4, 2]).state,
      play([0, 1, 2, 4, 3, 5, 7, 6, 8]).state,
    ]) {
      const before = JSON.stringify(state);
      const result = transition({
        state,
        actorSlotId: playerO,
        action: { type: "PLACE_MARK", cell: 8 },
        rng: createRng("terminal"),
      });
      expect(result).toEqual({
        status: "rejected",
        code: "MATCH_ALREADY_FINISHED",
      });
      expect(JSON.stringify(state)).toBe(before);
    }
  });
});

describe("serialization, projection, and determinism", () => {
  it("keeps State, Action, View, and Outcome JSON-safe", () => {
    const action: TicTacToeAction = { type: "PLACE_MARK", cell: 0 };
    const { state } = play([0, 3, 1, 4, 2]);
    const outcome = getOutcome(state);
    const view = projectView({
      state,
      viewer: { kind: "player", slotId: playerX },
    });
    for (const value of [state, action, view, outcome]) {
      expect(isJsonValue(value)).toBe(true);
      expect(JSON.parse(JSON.stringify(value)) as unknown).toEqual(value);
    }
  });

  it("projects a fresh authorized public view for every viewer", () => {
    const { state } = play([0, 4, 1]);
    const viewers: readonly Viewer[] = [
      { kind: "player", slotId: playerX },
      { kind: "player", slotId: playerO },
      { kind: "spectator" },
    ];
    const views = viewers.map((viewer) => projectView({ state, viewer }));
    expect(views[0]).toEqual(views[1]);
    expect(views[1]).toEqual(views[2]);
    expect(views[0]).not.toBe(state);
    expect(views[0]?.board).not.toBe(state.board);
    expect(views[0]).not.toHaveProperty("nextPlayerIndex");
    expect(JSON.stringify(views)).not.toContain("tic-tac-toe-seed");
  });

  it("repeats deeply equal results for identical inputs and accepted actions", () => {
    const cells = [0, 1, 2, 4, 3, 5, 7, 6, 8] as const;
    const first = play(cells, "repeatable");
    const second = play(cells, "repeatable");
    const firstOutcome: TicTacToeOutcome | null = getOutcome(first.state);
    const secondOutcome: TicTacToeOutcome | null = getOutcome(second.state);
    expect(first).toEqual(second);
    expect(firstOutcome).toEqual(secondOutcome);
    expect(first.rng.cursor).toBe(0);
  });
});
