import {
  createRng,
  definePlayerSlotId,
  isJsonValue,
} from "@online-game-hub/game-sdk";
import type { PlayerSlotId, RngState, Viewer } from "@online-game-hub/game-sdk";
import { describe, expect, it } from "vitest";

import {
  CONNECT_FOUR_CELL_COUNT,
  CONNECT_FOUR_COLUMNS,
  CONNECT_FOUR_ROWS,
  connectFourActionSchema,
  connectFourConfigSchema,
  connectFourOutcomeSchema,
  connectFourStateSchema,
  connectFourViewSchema,
  createInitialState,
  getOutcome,
  projectView,
  transition,
} from "../src/core/index.js";
import type { ConnectFourAction, ConnectFourState } from "../src/core/index.js";

const playerRed = definePlayerSlotId("player-red");
const playerYellow = definePlayerSlotId("player-yellow");
const players = Object.freeze([playerRed, playerYellow]) satisfies readonly [
  PlayerSlotId,
  PlayerSlotId,
];

function initialize(seed = "connect-four-seed"): {
  state: ConnectFourState;
  rng: RngState;
} {
  return createInitialState({ config: null, players, rng: createRng(seed) });
}

function acceptedDrop(
  state: ConnectFourState,
  rng: RngState,
  actorSlotId: PlayerSlotId,
  column: number,
): { state: ConnectFourState; rng: RngState } {
  const result = transition({
    state,
    actorSlotId,
    action: { type: "DROP_DISC", column },
    rng,
  });
  expect(result.status).toBe("accepted");
  if (result.status !== "accepted") {
    throw new Error(`Expected column ${column} to be accepted.`);
  }
  return result;
}

function play(
  columns: readonly number[],
  seed = "connect-four-seed",
): { state: ConnectFourState; rng: RngState } {
  let current = initialize(seed);
  for (const [index, column] of columns.entries()) {
    current = acceptedDrop(
      current.state,
      current.rng,
      index % 2 === 0 ? playerRed : playerYellow,
      column,
    );
  }
  return current;
}

function fullColumnState(column: number): ConnectFourState {
  const board = Array<PlayerSlotId | null>(CONNECT_FOUR_CELL_COUNT).fill(null);
  for (let row = 0; row < CONNECT_FOUR_ROWS; row += 1) {
    board[row * CONNECT_FOUR_COLUMNS + column] =
      row % 2 === 0 ? playerYellow : playerRed;
  }
  return connectFourStateSchema.parse({
    players,
    board,
    nextPlayerIndex: 0,
    resignedSlotId: null,
  }) as unknown as ConnectFourState;
}

describe("schemas and initialization", () => {
  it("accepts null Config and only strict DROP_DISC | RESIGN intents", () => {
    expect(connectFourConfigSchema.safeParse(null).success).toBe(true);
    expect(connectFourConfigSchema.safeParse({}).success).toBe(false);
    expect(
      connectFourActionSchema.safeParse({ type: "DROP_DISC", column: 6 })
        .success,
    ).toBe(true);
    expect(connectFourActionSchema.safeParse({ type: "RESIGN" }).success).toBe(
      true,
    );
    for (const action of [
      { type: "DROP_DISC", column: -1 },
      { type: "DROP_DISC", column: 7 },
      { type: "DROP_DISC", column: 1.5 },
      { type: "DROP_DISC", column: 0, row: 5 },
      { type: "DROP_DISC", column: 0, actorSlotId: playerYellow },
      { type: "DROP_DISC", column: 0, outcome: { type: "DRAW" } },
      { type: "RESIGN", column: 0 },
    ]) {
      expect(connectFourActionSchema.safeParse(action).success).toBe(false);
    }
  });

  it("initializes a strict deterministic 7 × 6 State without consuming RNG", () => {
    const first = initialize("same-seed");
    const second = initialize("same-seed");
    expect(first).toEqual(second);
    expect(first.state.board).toEqual(
      Array<null>(CONNECT_FOUR_CELL_COUNT).fill(null),
    );
    expect(first.state.players).toEqual(players);
    expect(first.state.nextPlayerIndex).toBe(0);
    expect(first.state.resignedSlotId).toBeNull();
    expect(first.rng.cursor).toBe(0);
    expect(connectFourStateSchema.safeParse(first.state).success).toBe(true);
    expect(getOutcome(first.state)).toBeNull();
  });

  it("requires exactly two distinct slots", () => {
    const rng = createRng("player-count");
    expect(() =>
      createInitialState({ config: null, players: [playerRed], rng }),
    ).toThrow(/exactly two distinct/u);
    expect(() =>
      createInitialState({
        config: null,
        players: [playerRed, playerRed],
        rng,
      }),
    ).toThrow(/exactly two distinct/u);
  });
});

describe("gravity, turns, and rejection", () => {
  it("drops to the lowest empty row, stacks upward, alternates turns, and keeps inputs immutable", () => {
    const initial = initialize();
    const action = Object.freeze({
      type: "DROP_DISC",
      column: 3,
    } as const satisfies ConnectFourAction);
    const before = JSON.parse(JSON.stringify(initial)) as unknown;
    const first = transition({
      state: initial.state,
      actorSlotId: playerRed,
      action,
      rng: initial.rng,
    });
    expect(first.status).toBe("accepted");
    expect(initial).toEqual(before);
    expect(action).toEqual({ type: "DROP_DISC", column: 3 });
    if (first.status !== "accepted") return;
    expect(first.state.board[5 * CONNECT_FOUR_COLUMNS + 3]).toBe(playerRed);
    expect(first.state.nextPlayerIndex).toBe(1);
    expect(first.rng).toBe(initial.rng);
    const second = acceptedDrop(first.state, first.rng, playerYellow, 3);
    expect(second.state.board[4 * CONNECT_FOUR_COLUMNS + 3]).toBe(playerYellow);
    expect(second.state.board[3 * CONNECT_FOUR_COLUMNS + 3]).toBeNull();
  });

  it("rejects non-player, wrong-turn, and out-of-bounds direct Core input without candidate State/RNG", () => {
    const initial = initialize();
    const stranger = definePlayerSlotId("stranger");
    const cases = [
      [stranger, 0, "NOT_A_PLAYER"],
      [playerYellow, 0, "NOT_YOUR_TURN"],
      [playerRed, -1, "COLUMN_OUT_OF_BOUNDS"],
      [playerRed, 7, "COLUMN_OUT_OF_BOUNDS"],
    ] as const;
    for (const [actorSlotId, column, code] of cases) {
      const result = transition({
        state: initial.state,
        actorSlotId,
        action: { type: "DROP_DISC", column },
        rng: initial.rng,
      });
      expect(result).toEqual({ status: "rejected", code });
      expect("state" in result).toBe(false);
      expect("rng" in result).toBe(false);
      expect(initial.rng.cursor).toBe(0);
    }
  });

  it("accepts off-turn resignation and rejects outsider resignation immutably", () => {
    const initial = initialize("resign-seed");
    const action = Object.freeze({ type: "RESIGN" } as const);
    const before = JSON.parse(JSON.stringify(initial)) as unknown;
    const result = transition({
      state: initial.state,
      actorSlotId: playerYellow,
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
    expect(result.state.resignedSlotId).toBe(playerYellow);
    expect(result.rng).toBe(initial.rng);
    expect(getOutcome(result.state)).toEqual({
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: playerRed,
      resignedSlotId: playerYellow,
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

  it.each(Array.from({ length: CONNECT_FOUR_COLUMNS }, (_, column) => column))(
    "rejects full column %i without changing State or RNG",
    (column) => {
      const state = fullColumnState(column);
      const rng = createRng(`full-column-${column}`);
      const before = JSON.stringify(state);
      const result = transition({
        state,
        actorSlotId: playerRed,
        action: { type: "DROP_DISC", column },
        rng,
      });
      expect(result).toEqual({ status: "rejected", code: "COLUMN_FULL" });
      expect(JSON.stringify(state)).toBe(before);
      expect(rng.cursor).toBe(0);
    },
  );
});

describe("outcomes", () => {
  it.each([
    {
      name: "horizontal",
      columns: [0, 0, 1, 1, 2, 2, 3],
      cells: [35, 36, 37, 38],
    },
    {
      name: "vertical",
      columns: [0, 1, 0, 1, 0, 1, 0],
      cells: [14, 21, 28, 35],
    },
    {
      name: "down-left diagonal",
      columns: [0, 1, 1, 2, 4, 2, 2, 3, 4, 3, 5, 3, 3],
      cells: [17, 23, 29, 35],
    },
    {
      name: "down-right diagonal",
      columns: [6, 5, 5, 4, 2, 4, 4, 3, 2, 3, 1, 3, 3],
      cells: [17, 25, 33, 41],
    },
  ])("detects a $name win", ({ columns, cells }) => {
    const outcome = getOutcome(play(columns).state);
    expect(outcome).toEqual({
      type: "WIN",
      winnerSlotId: playerRed,
      winningCells: cells,
    });
    expect(connectFourOutcomeSchema.safeParse(outcome).success).toBe(true);
  });

  it("reaches a legal 42-action draw without advancing RNG", () => {
    const drawColumns = [
      3, 3, 5, 5, 1, 2, 6, 6, 0, 4, 4, 6, 6, 0, 4, 5, 4, 0, 2, 3, 1, 3, 0, 0, 2,
      1, 6, 2, 6, 1, 5, 0, 2, 5, 2, 4, 3, 4, 5, 3, 1, 1,
    ] as const;
    const result = play(drawColumns, "draw-seed");
    expect(result.state.board.every((cell) => cell !== null)).toBe(true);
    expect(getOutcome(result.state)).toEqual({ type: "DRAW" });
    expect(result.rng.cursor).toBe(0);
  });

  it("rejects every action after a win or draw", () => {
    const terminalStates = [
      play([0, 0, 1, 1, 2, 2, 3]).state,
      play([
        3, 3, 5, 5, 1, 2, 6, 6, 0, 4, 4, 6, 6, 0, 4, 5, 4, 0, 2, 3, 1, 3, 0, 0,
        2, 1, 6, 2, 6, 1, 5, 0, 2, 5, 2, 4, 3, 4, 5, 3, 1, 1,
      ]).state,
    ];
    for (const state of terminalStates) {
      const before = JSON.stringify(state);
      const result = transition({
        state,
        actorSlotId: playerYellow,
        action: { type: "DROP_DISC", column: 6 },
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
      actorSlotId: playerYellow,
      action: { type: "RESIGN" },
      rng: initial.rng,
    });
    if (resignation.status !== "accepted") {
      throw new Error("Expected resignation to be accepted.");
    }
    const before = JSON.stringify(resignation.state);
    for (const action of [
      { type: "DROP_DISC", column: 0 },
      { type: "RESIGN" },
    ] as const) {
      expect(
        transition({
          state: resignation.state,
          actorSlotId: playerRed,
          action,
          rng: resignation.rng,
        }),
      ).toEqual({ status: "rejected", code: "MATCH_ALREADY_FINISHED" });
    }
    expect(JSON.stringify(resignation.state)).toBe(before);
  });
});

describe("serialization, projection, and determinism", () => {
  it("keeps State, Action, View, and Outcome JSON-safe with strict runtime schemas", () => {
    const action: ConnectFourAction = { type: "DROP_DISC", column: 0 };
    const { state } = play([0, 0, 1, 1, 2, 2, 3]);
    const outcome = getOutcome(state);
    const view = projectView({
      state,
      viewer: { kind: "player", slotId: playerRed },
    });
    expect(connectFourStateSchema.safeParse(state).success).toBe(true);
    expect(connectFourActionSchema.safeParse(action).success).toBe(true);
    expect(connectFourViewSchema.safeParse(view).success).toBe(true);
    expect(connectFourOutcomeSchema.safeParse(outcome).success).toBe(true);
    for (const value of [state, action, view, outcome]) {
      expect(isJsonValue(value)).toBe(true);
      expect(JSON.parse(JSON.stringify(value)) as unknown).toEqual(value);
    }

    const initial = initialize();
    const resignation = transition({
      state: initial.state,
      actorSlotId: playerYellow,
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
    expect(connectFourStateSchema.safeParse(resignation.state).success).toBe(
      true,
    );
    expect(connectFourViewSchema.safeParse(resignedView).success).toBe(true);
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

  it("projects a fresh authorized public View for every viewer", () => {
    const { state } = play([3, 2, 3]);
    const viewers: readonly Viewer[] = [
      { kind: "player", slotId: playerRed },
      { kind: "player", slotId: playerYellow },
      { kind: "spectator" },
    ];
    const views = viewers.map((viewer) => projectView({ state, viewer }));
    expect(views.map((view) => view.yourDisc)).toEqual(["RED", "YELLOW", null]);
    expect({ ...views[0], yourDisc: null }).toEqual(views[2]);
    expect({ ...views[1], yourDisc: null }).toEqual(views[2]);
    expect(views[0]).not.toBe(state);
    expect(views[0]?.board).not.toBe(state.board);
    expect(views[0]).not.toHaveProperty("nextPlayerIndex");
    expect(JSON.stringify(views)).not.toContain("connect-four-seed");
  });

  it("repeats deeply equal State, Outcome, and zero RNG cursor", () => {
    const columns = [0, 0, 1, 1, 2, 2, 3] as const;
    const first = play(columns, "repeatable");
    const second = play(columns, "repeatable");
    expect(first).toEqual(second);
    expect(getOutcome(first.state)).toEqual(getOutcome(second.state));
    expect(first.rng.cursor).toBe(0);
  });
});
