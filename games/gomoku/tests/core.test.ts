import {
  createRng,
  definePlayerSlotId,
  isJsonValue,
} from "@online-game-hub/game-sdk";
import type { PlayerSlotId, RngState, Viewer } from "@online-game-hub/game-sdk";
import { describe, expect, it } from "vitest";

import {
  gomokuActionSchema,
  gomokuConfigSchema,
  gomokuOutcomeSchema,
  gomokuStateSchema,
  gomokuViewSchema,
  createInitialState,
  getOutcome,
  projectView,
  transition,
} from "../src/core/index.js";
import type {
  GomokuAction,
  GomokuBoardSize,
  GomokuConfig,
  GomokuState,
} from "../src/core/index.js";

const playerBlack = definePlayerSlotId("player-black");
const playerWhite = definePlayerSlotId("player-white");
const players = Object.freeze([playerBlack, playerWhite]) satisfies readonly [
  PlayerSlotId,
  PlayerSlotId,
];

function config(boardSize: GomokuBoardSize = 15): GomokuConfig {
  return Object.freeze({ boardSize, winLength: 5 });
}

function initialize(
  boardSize: GomokuBoardSize = 15,
  seed = "gomoku-seed",
): { state: GomokuState; rng: RngState } {
  return createInitialState({
    config: config(boardSize),
    players,
    rng: createRng(seed),
  });
}

function acceptedPlacement(
  state: GomokuState,
  rng: RngState,
  actorSlotId: PlayerSlotId,
  cell: number,
): { state: GomokuState; rng: RngState } {
  const result = transition({
    state,
    actorSlotId,
    action: { type: "PLACE_STONE", cell },
    rng,
  });
  expect(result.status).toBe("accepted");
  if (result.status !== "accepted") {
    throw new Error(`Expected cell ${cell} to be accepted.`);
  }
  return result;
}

function play(
  cells: readonly number[],
  boardSize: GomokuBoardSize = 15,
  seed = "gomoku-seed",
): { state: GomokuState; rng: RngState } {
  let current = initialize(boardSize, seed);
  for (const [index, cell] of cells.entries()) {
    current = acceptedPlacement(
      current.state,
      current.rng,
      index % 2 === 0 ? playerBlack : playerWhite,
      cell,
    );
  }
  return current;
}

function alternatingWin(
  blackCells: readonly [number, number, number, number, number],
): readonly number[] {
  const whiteCells = [0, 1, 2, 3].filter((cell) => !blackCells.includes(cell));
  while (whiteCells.length < 4) {
    const candidate = whiteCells.length + 15;
    if (!blackCells.includes(candidate)) whiteCells.push(candidate);
  }
  return [
    blackCells[0],
    whiteCells[0] ?? 0,
    blackCells[1],
    whiteCells[1] ?? 1,
    blackCells[2],
    whiteCells[2] ?? 2,
    blackCells[3],
    whiteCells[3] ?? 3,
    blackCells[4],
  ];
}

function drawSequence(boardSize: GomokuBoardSize): readonly number[] {
  const black: number[] = [];
  const white: number[] = [];
  for (let row = 0; row < boardSize; row += 1) {
    for (let column = 0; column < boardSize; column += 1) {
      const cell = row * boardSize + column;
      ((row + Math.floor(column / 4)) % 2 === 0 ? black : white).push(cell);
    }
  }
  const cells: number[] = [];
  for (let index = 0; index < black.length; index += 1) {
    const blackCell = black[index];
    if (blackCell !== undefined) cells.push(blackCell);
    const whiteCell = white[index];
    if (whiteCell !== undefined) cells.push(whiteCell);
  }
  return cells;
}

describe("Config, Action, and initialization", () => {
  it("accepts strict 15 × 15 and 19 × 19 Config and rejects every unsupported variant", () => {
    for (const boardSize of [15, 19] as const) {
      expect(
        gomokuConfigSchema.safeParse({ boardSize, winLength: 5 }).success,
      ).toBe(true);
    }
    for (const invalid of [
      null,
      {},
      { boardSize: 14, winLength: 5 },
      { boardSize: 20, winLength: 5 },
      { boardSize: 15, winLength: 4 },
      { boardSize: 19, winLength: 6 },
      { boardSize: 15 },
      { boardSize: 15, winLength: 5, forbiddenMoves: true },
    ]) {
      expect(gomokuConfigSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("accepts only strict PLACE_STONE | RESIGN intents", () => {
    expect(
      gomokuActionSchema.safeParse({ type: "PLACE_STONE", cell: 360 }).success,
    ).toBe(true);
    expect(gomokuActionSchema.safeParse({ type: "RESIGN" }).success).toBe(true);
    for (const action of [
      { type: "PLACE_STONE", cell: -1 },
      { type: "PLACE_STONE", cell: 361 },
      { type: "PLACE_STONE", cell: 1.5 },
      { type: "PLACE_STONE", cell: 0, actorSlotId: playerWhite },
      { type: "PLACE_STONE", cell: 0, revision: 0 },
      { type: "PLACE_STONE", cell: 0, state: {} },
      { type: "PLACE_STONE", cell: 0, outcome: { type: "DRAW" } },
      { type: "PLACE_STONE", cell: 0, randomResult: 1 },
      { type: "RESIGN", cell: 0 },
    ]) {
      expect(gomokuActionSchema.safeParse(action).success).toBe(false);
    }
  });

  it.each([15, 19] as const)(
    "initializes an immutable deterministic %i × %i State without consuming RNG",
    (boardSize) => {
      const initialConfig = Object.freeze({ boardSize, winLength: 5 } as const);
      const rng = Object.freeze(createRng(`init-${boardSize}`));
      const first = createInitialState({ config: initialConfig, players, rng });
      const second = createInitialState({
        config: initialConfig,
        players,
        rng,
      });
      expect(first).toEqual(second);
      expect(first.state.config).toEqual(initialConfig);
      expect(first.state.config).not.toBe(initialConfig);
      expect(first.state.board).toEqual(
        Array<null>(boardSize * boardSize).fill(null),
      );
      expect(first.state.players).toEqual(players);
      expect(first.state.nextPlayerIndex).toBe(0);
      expect(first.state.resignedSlotId).toBeNull();
      expect(first.rng).toBe(rng);
      expect(initialConfig).toEqual({ boardSize, winLength: 5 });
      expect(rng.cursor).toBe(0);
      expect(gomokuStateSchema.safeParse(first.state).success).toBe(true);
      expect(getOutcome(first.state)).toBeNull();
    },
  );

  it("requires exactly two distinct stable slots", () => {
    const rng = createRng("player-count");
    expect(() =>
      createInitialState({ config: config(), players: [playerBlack], rng }),
    ).toThrow(/exactly two distinct/u);
    expect(() =>
      createInitialState({
        config: config(),
        players: [playerBlack, playerBlack],
        rng,
      }),
    ).toThrow(/exactly two distinct/u);
  });
});

describe("placements, turns, and rejection", () => {
  it("places a stone, alternates turns, and leaves State, Action, Config, and RNG inputs unchanged", () => {
    const initialConfig = Object.freeze({
      boardSize: 15,
      winLength: 5,
    } as const);
    const rng = Object.freeze(createRng("immutable"));
    const initial = createInitialState({ config: initialConfig, players, rng });
    const action = Object.freeze({
      type: "PLACE_STONE",
      cell: 112,
    } as const satisfies GomokuAction);
    const before = JSON.parse(JSON.stringify(initial)) as unknown;
    const result = transition({
      state: initial.state,
      actorSlotId: playerBlack,
      action,
      rng,
    });
    expect(result.status).toBe("accepted");
    expect(initial).toEqual(before);
    expect(initialConfig).toEqual({ boardSize: 15, winLength: 5 });
    expect(action).toEqual({ type: "PLACE_STONE", cell: 112 });
    expect(rng.cursor).toBe(0);
    if (result.status !== "accepted") return;
    expect(result.state.board[112]).toBe(playerBlack);
    expect(result.state.nextPlayerIndex).toBe(1);
    expect(result.rng).toBe(rng);
    expect(result.state).not.toBe(initial.state);
    expect(result.state.board).not.toBe(initial.state.board);
  });

  it("rejects non-player, wrong-turn, out-of-bounds, and occupied cells without candidate State/RNG", () => {
    const initial = initialize();
    const stranger = definePlayerSlotId("stranger");
    const cases = [
      [initial.state, stranger, 0, "NOT_A_PLAYER"],
      [initial.state, playerWhite, 0, "NOT_YOUR_TURN"],
      [initial.state, playerBlack, -1, "CELL_OUT_OF_BOUNDS"],
      [initial.state, playerBlack, 225, "CELL_OUT_OF_BOUNDS"],
    ] as const;
    for (const [state, actorSlotId, cell, code] of cases) {
      const before = JSON.stringify(state);
      const result = transition({
        state,
        actorSlotId,
        action: { type: "PLACE_STONE", cell },
        rng: initial.rng,
      });
      expect(result).toEqual({ status: "rejected", code });
      expect("state" in result).toBe(false);
      expect("rng" in result).toBe(false);
      expect(JSON.stringify(state)).toBe(before);
      expect(initial.rng.cursor).toBe(0);
    }

    const afterFirst = acceptedPlacement(
      initial.state,
      initial.rng,
      playerBlack,
      0,
    );
    const occupied = transition({
      state: afterFirst.state,
      actorSlotId: playerWhite,
      action: { type: "PLACE_STONE", cell: 0 },
      rng: afterFirst.rng,
    });
    expect(occupied).toEqual({ status: "rejected", code: "CELL_OCCUPIED" });
  });

  it("accepts off-turn resignation and rejects outsider resignation immutably", () => {
    const initial = initialize(19, "resign-seed");
    const action = Object.freeze({ type: "RESIGN" } as const);
    const before = JSON.parse(JSON.stringify(initial)) as unknown;
    const result = transition({
      state: initial.state,
      actorSlotId: playerWhite,
      action,
      rng: initial.rng,
    });
    expect(initial).toEqual(before);
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") {
      throw new Error("Expected off-turn resignation to be accepted.");
    }
    expect(result.state.board).toEqual(initial.state.board);
    expect(result.state.nextPlayerIndex).toBe(0);
    expect(result.state.resignedSlotId).toBe(playerWhite);
    expect(result.rng).toBe(initial.rng);
    expect(getOutcome(result.state)).toEqual({
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: playerBlack,
      resignedSlotId: playerWhite,
    });
    expect(
      transition({
        state: initial.state,
        actorSlotId: definePlayerSlotId("outsider"),
        action,
        rng: initial.rng,
      }),
    ).toEqual({ status: "rejected", code: "NOT_A_PLAYER" });
    expect(initial).toEqual(before);
  });
});

describe("outcomes", () => {
  it.each([
    {
      name: "horizontal",
      blackCells: [108, 109, 110, 111, 112],
    },
    {
      name: "vertical",
      blackCells: [52, 67, 82, 97, 112],
    },
    {
      name: "down-right diagonal",
      blackCells: [48, 64, 80, 96, 112],
    },
    {
      name: "down-left diagonal",
      blackCells: [52, 66, 80, 94, 108],
    },
  ] as const)("detects a $name win", ({ blackCells }) => {
    const outcome = getOutcome(
      play(
        alternatingWin(
          blackCells as unknown as [number, number, number, number, number],
        ),
      ).state,
    );
    expect(outcome).toEqual({
      type: "WIN",
      winnerSlotId: playerBlack,
      winningCells: blackCells,
    });
    expect(gomokuOutcomeSchema.safeParse(outcome).success).toBe(true);
  });

  it("treats a six-stone long line as a win and records its canonical first five cells", () => {
    const blackCells = [105, 106, 107, 109, 110, 108] as const;
    const whiteCells = [0, 2, 4, 6, 8] as const;
    const sequence: number[] = [];
    for (const [index, blackCell] of blackCells.entries()) {
      sequence.push(blackCell);
      const whiteCell = whiteCells[index];
      if (whiteCell !== undefined) sequence.push(whiteCell);
    }
    const result = play(sequence);
    expect(getOutcome(result.state)).toEqual({
      type: "WIN",
      winnerSlotId: playerBlack,
      winningCells: [105, 106, 107, 108, 109],
    });
  });

  it("reaches a legal full-board 15 × 15 draw without consuming RNG", () => {
    const sequence = drawSequence(15);
    expect(sequence).toHaveLength(225);
    const result = play(sequence, 15, "draw-seed");
    expect(result.state.board.every((cell) => cell !== null)).toBe(true);
    expect(getOutcome(result.state)).toEqual({ type: "DRAW" });
    expect(result.rng.cursor).toBe(0);
  });

  it("rejects every action after a win or draw", () => {
    const terminalStates = [
      play(alternatingWin([108, 109, 110, 111, 112])).state,
      play(drawSequence(15)).state,
    ];
    for (const state of terminalStates) {
      const before = JSON.stringify(state);
      const result = transition({
        state,
        actorSlotId: playerWhite,
        action: { type: "PLACE_STONE", cell: 224 },
        rng: createRng("terminal"),
      });
      expect(result).toEqual({
        status: "rejected",
        code: "MATCH_ALREADY_FINISHED",
      });
      expect(JSON.stringify(state)).toBe(before);
    }
  });

  it("rejects every action after resignation", () => {
    const initial = initialize();
    const resignation = transition({
      state: initial.state,
      actorSlotId: playerWhite,
      action: { type: "RESIGN" },
      rng: initial.rng,
    });
    if (resignation.status !== "accepted") {
      throw new Error("Expected resignation to be accepted.");
    }
    const before = JSON.stringify(resignation.state);
    for (const action of [
      { type: "PLACE_STONE", cell: 0 },
      { type: "RESIGN" },
    ] as const) {
      expect(
        transition({
          state: resignation.state,
          actorSlotId: playerBlack,
          action,
          rng: resignation.rng,
        }),
      ).toEqual({ status: "rejected", code: "MATCH_ALREADY_FINISHED" });
    }
    expect(JSON.stringify(resignation.state)).toBe(before);
  });
});

describe("serialization, projection, and seeded determinism", () => {
  it("keeps Config, State, Action, View, and Outcome JSON-safe with strict runtime schemas", () => {
    const gameConfig = config(19);
    const action: GomokuAction = { type: "PLACE_STONE", cell: 180 };
    const { state } = play(alternatingWin([160, 180, 200, 220, 240]), 19);
    const outcome = getOutcome(state);
    const view = projectView({
      state,
      viewer: { kind: "player", slotId: playerBlack },
    });
    expect(gomokuConfigSchema.safeParse(gameConfig).success).toBe(true);
    expect(gomokuStateSchema.safeParse(state).success).toBe(true);
    expect(gomokuActionSchema.safeParse(action).success).toBe(true);
    expect(gomokuViewSchema.safeParse(view).success).toBe(true);
    expect(gomokuOutcomeSchema.safeParse(outcome).success).toBe(true);
    for (const value of [gameConfig, state, action, view, outcome]) {
      expect(isJsonValue(value)).toBe(true);
      expect(JSON.parse(JSON.stringify(value)) as unknown).toEqual(value);
    }

    const initial = initialize(19);
    const resignation = transition({
      state: initial.state,
      actorSlotId: playerWhite,
      action: { type: "RESIGN" },
      rng: initial.rng,
    });
    if (resignation.status !== "accepted") {
      throw new Error("Expected resignation to be accepted.");
    }
    const resignedView = projectView({
      state: resignation.state,
      viewer: { kind: "spectator" },
    });
    expect(gomokuStateSchema.safeParse(resignation.state).success).toBe(true);
    expect(gomokuViewSchema.safeParse(resignedView).success).toBe(true);
    for (const value of [
      resignation.state,
      { type: "RESIGN" },
      resignedView,
      resignedView.outcome,
    ]) {
      expect(isJsonValue(value)).toBe(true);
      expect(JSON.parse(JSON.stringify(value)) as unknown).toEqual(value);
    }
  });

  it("projects a fresh authorized public View without Core-only fields or hidden data", () => {
    const { state } = play([112, 111, 113]);
    const viewers: readonly Viewer[] = [
      { kind: "player", slotId: playerBlack },
      { kind: "player", slotId: playerWhite },
      { kind: "spectator" },
    ];
    const views = viewers.map((viewer) => projectView({ state, viewer }));
    expect(views.map((view) => view.yourStone)).toEqual([
      "BLACK",
      "WHITE",
      null,
    ]);
    expect({ ...views[0], yourStone: null }).toEqual(views[2]);
    expect({ ...views[1], yourStone: null }).toEqual(views[2]);
    expect(views[0]).not.toBe(state);
    expect(views[0]?.board).not.toBe(state.board);
    expect(views[0]).not.toHaveProperty("config");
    expect(views[0]).not.toHaveProperty("nextPlayerIndex");
    expect(views[0]).not.toHaveProperty("rng");
    expect(JSON.stringify(views)).not.toContain("gomoku-seed");
  });

  it.each([15, 19] as const)(
    "repeats deeply equal %i × %i State, View, Outcome, and zero RNG cursor",
    (boardSize) => {
      const cells =
        boardSize === 15 ? [108, 0, 109, 1, 110] : [180, 0, 181, 1, 182];
      const first = play(cells, boardSize, "repeatable");
      const second = play(cells, boardSize, "repeatable");
      expect(first).toEqual(second);
      expect(getOutcome(first.state)).toEqual(getOutcome(second.state));
      expect(
        projectView({
          state: first.state,
          viewer: { kind: "player", slotId: playerBlack },
        }),
      ).toEqual(
        projectView({
          state: second.state,
          viewer: { kind: "player", slotId: playerBlack },
        }),
      );
      expect(first.rng.cursor).toBe(0);
    },
  );
});
