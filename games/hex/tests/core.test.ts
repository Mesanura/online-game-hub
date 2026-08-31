import {
  createRng,
  definePlayerSlotId,
  isJsonValue,
} from "@online-game-hub/game-sdk";
import type { PlayerSlotId, RngState, Viewer } from "@online-game-hub/game-sdk";
import { describe, expect, it } from "vitest";

import {
  HEX_CELL_COUNT,
  createInitialState,
  getOutcome,
  hexActionSchema,
  hexConfigSchema,
  hexOutcomeSchema,
  hexStateSchema,
  hexViewSchema,
  projectView,
  transition,
} from "../src/core/index.js";
import type { HexAction, HexState } from "../src/core/index.js";

const playerBlue = definePlayerSlotId("player-blue");
const playerRed = definePlayerSlotId("player-red");
const players = Object.freeze([playerBlue, playerRed] as const);

function initialize(seed = "hex-seed"): { state: HexState; rng: RngState } {
  return createInitialState({ config: null, players, rng: createRng(seed) });
}

function acceptedAction(
  state: HexState,
  rng: RngState,
  actorSlotId: PlayerSlotId,
  action: HexAction,
): { state: HexState; rng: RngState } {
  const result = transition({ state, rng, actorSlotId, action });
  if (result.status !== "accepted") {
    throw new Error(`Expected ${action.type} to be accepted.`);
  }
  return result;
}

function play(
  cells: readonly number[],
  seed = "hex-play",
): {
  state: HexState;
  rng: RngState;
} {
  let current = initialize(seed);
  for (const [index, cell] of cells.entries()) {
    current = acceptedAction(
      current.state,
      current.rng,
      index % 2 === 0 ? playerBlue : playerRed,
      { type: "PLACE_STONE", cell },
    );
  }
  return current;
}

function stateWithOwners(
  blueCells: readonly number[],
  redCells: readonly number[] = [],
  resignedSlotId: PlayerSlotId | null = null,
): HexState {
  const board = Array<PlayerSlotId | null>(HEX_CELL_COUNT).fill(null);
  for (const cell of blueCells) board[cell] = playerBlue;
  for (const cell of redCells) board[cell] = playerRed;
  return hexStateSchema.parse({
    players,
    board,
    nextPlayerIndex: 0,
    resignedSlotId,
  }) as unknown as HexState;
}

const blueLeftPath = Array.from({ length: 11 }, (_, row) => row * 11);
const blueRightPath = Array.from({ length: 11 }, (_, row) => row * 11 + 10);
const redTopPath = Array.from({ length: 11 }, (_, column) => column);
const redBottomPath = Array.from({ length: 11 }, (_, column) => 110 + column);

describe("Config, Action, and initialization", () => {
  it("accepts only null Config and strict minimal Actions", () => {
    expect(hexConfigSchema.parse(null)).toBeNull();
    for (const invalid of [{}, [], false, 0, "null"]) {
      expect(hexConfigSchema.safeParse(invalid).success).toBe(false);
    }

    expect(
      hexActionSchema.safeParse({ type: "PLACE_STONE", cell: 120 }).success,
    ).toBe(true);
    expect(hexActionSchema.safeParse({ type: "RESIGN" }).success).toBe(true);
    for (const invalid of [
      { type: "PLACE_STONE", cell: -1 },
      { type: "PLACE_STONE", cell: 121 },
      { type: "PLACE_STONE", cell: 1.5 },
      { type: "PLACE_STONE", cell: 0, actorSlotId: playerBlue },
      { type: "PLACE_STONE", cell: 0, revision: 0 },
      { type: "PLACE_STONE", cell: 0, state: {} },
      { type: "PLACE_STONE", cell: 0, outcome: {} },
      { type: "RESIGN", actorSlotId: playerRed },
      { type: "RESIGN", randomResult: true },
      { type: "SWAP" },
    ]) {
      expect(hexActionSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("initializes an immutable empty 11 × 11 board with Blue first and zero RNG consumption", () => {
    const rng = Object.freeze(createRng("hex-init"));
    const first = createInitialState({ config: null, players, rng });
    const second = createInitialState({ config: null, players, rng });
    expect(first).toEqual(second);
    expect(first.state).toEqual({
      players,
      board: Array<null>(121).fill(null),
      nextPlayerIndex: 0,
      resignedSlotId: null,
    });
    expect(first.rng).toBe(rng);
    expect(first.rng.cursor).toBe(0);
    expect(Object.isFrozen(first.state)).toBe(true);
    expect(Object.isFrozen(first.state.board)).toBe(true);
    expect(getOutcome(first.state)).toBeNull();
  });

  it("requires exactly two distinct stable slots", () => {
    const rng = createRng("hex-players");
    expect(() =>
      createInitialState({ config: null, players: [playerBlue], rng }),
    ).toThrow(/exactly two distinct/u);
    expect(() =>
      createInitialState({
        config: null,
        players: [playerBlue, playerBlue],
        rng,
      }),
    ).toThrow(/exactly two distinct/u);
  });
});

describe("placements, resignation, and rejection order", () => {
  it("places one stone, alternates turns, and leaves every input unchanged", () => {
    const rng = Object.freeze(createRng("hex-immutable"));
    const initial = createInitialState({ config: null, players, rng });
    const action = Object.freeze({
      type: "PLACE_STONE",
      cell: 60,
    } as const satisfies HexAction);
    const before = JSON.parse(JSON.stringify(initial)) as unknown;
    const result = transition({
      state: initial.state,
      actorSlotId: playerBlue,
      action,
      rng,
    });
    expect(result.status).toBe("accepted");
    expect(initial).toEqual(before);
    expect(action).toEqual({ type: "PLACE_STONE", cell: 60 });
    expect(rng.cursor).toBe(0);
    if (result.status !== "accepted") return;
    expect(result.state.board[60]).toBe(playerBlue);
    expect(result.state.nextPlayerIndex).toBe(1);
    expect(result.rng).toBe(rng);
    expect(result.state).not.toBe(initial.state);
    expect(result.state.board).not.toBe(initial.state.board);
  });

  it("uses the frozen legality order and never returns candidate State/RNG for rejection", () => {
    const initial = initialize();
    const stranger = definePlayerSlotId("stranger");
    const cases = [
      [stranger, { type: "PLACE_STONE", cell: 0 }, "NOT_A_PLAYER"],
      [playerRed, { type: "PLACE_STONE", cell: -1 }, "NOT_YOUR_TURN"],
      [playerBlue, { type: "PLACE_STONE", cell: -1 }, "CELL_OUT_OF_BOUNDS"],
      [playerBlue, { type: "PLACE_STONE", cell: 121 }, "CELL_OUT_OF_BOUNDS"],
    ] as const;
    for (const [actorSlotId, action, code] of cases) {
      const before = JSON.stringify(initial.state);
      const result = transition({
        state: initial.state,
        actorSlotId,
        action: action as HexAction,
        rng: initial.rng,
      });
      expect(result).toEqual({ status: "rejected", code });
      expect("state" in result).toBe(false);
      expect("rng" in result).toBe(false);
      expect(JSON.stringify(initial.state)).toBe(before);
      expect(initial.rng.cursor).toBe(0);
    }

    const afterBlue = acceptedAction(initial.state, initial.rng, playerBlue, {
      type: "PLACE_STONE",
      cell: 0,
    });
    expect(
      transition({
        state: afterBlue.state,
        actorSlotId: playerRed,
        action: { type: "PLACE_STONE", cell: 0 },
        rng: afterBlue.rng,
      }),
    ).toEqual({ status: "rejected", code: "CELL_OCCUPIED" });
  });

  it("accepts an off-turn resignation, awards the opponent, and rejects every later Action", () => {
    const initial = initialize("hex-resign");
    const resigned = acceptedAction(initial.state, initial.rng, playerRed, {
      type: "RESIGN",
    });
    expect(resigned.state.resignedSlotId).toBe(playerRed);
    expect(resigned.state.nextPlayerIndex).toBe(0);
    expect(resigned.rng.cursor).toBe(0);
    expect(getOutcome(resigned.state)).toEqual({
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: playerBlue,
      resignedSlotId: playerRed,
    });
    expect(
      transition({
        state: resigned.state,
        actorSlotId: definePlayerSlotId("terminal-stranger"),
        action: { type: "RESIGN" },
        rng: resigned.rng,
      }),
    ).toEqual({ status: "rejected", code: "MATCH_ALREADY_FINISHED" });
  });
});

describe("connection outcomes and canonical paths", () => {
  it.each([
    [
      "Blue top-right to bottom-left on the left edge",
      playerBlue,
      blueLeftPath,
    ],
    [
      "Blue top-right to bottom-left on the right edge",
      playerBlue,
      blueRightPath,
    ],
    ["Red top-left to bottom-right on the top edge", playerRed, redTopPath],
    [
      "Red top-left to bottom-right on the bottom edge",
      playerRed,
      redBottomPath,
    ],
  ] as const)("detects %s", (_name, winner, path) => {
    const state =
      winner === playerBlue ? stateWithOwners(path) : stateWithOwners([], path);
    expect(getOutcome(state)).toEqual({
      type: "WIN",
      reason: "CONNECTION",
      winnerSlotId: winner,
      winningPath: path,
    });
  });

  it("supports all six undirected adjacency directions without row wrapping", () => {
    const zigzag = [
      5, 15, 16, 26, 27, 37, 38, 48, 49, 59, 60, 70, 71, 81, 82, 92, 93, 103,
      104, 114,
    ];
    expect(getOutcome(stateWithOwners(zigzag))).toMatchObject({
      type: "WIN",
      reason: "CONNECTION",
      winnerSlotId: playerBlue,
    });
    expect(
      getOutcome(stateWithOwners([10, ...blueLeftPath.slice(1)])),
    ).toBeNull();
  });

  it("does not finish incomplete connections", () => {
    expect(getOutcome(stateWithOwners(blueLeftPath.slice(0, 10)))).toBeNull();
    expect(getOutcome(stateWithOwners([], redTopPath.slice(0, 10)))).toBeNull();
  });

  it("chooses the shortest path and breaks equal choices by source/neighbor cell order", () => {
    const equalLanes = stateWithOwners([...blueLeftPath, ...blueRightPath]);
    expect(getOutcome(equalLanes)).toEqual({
      type: "WIN",
      reason: "CONNECTION",
      winnerSlotId: playerBlue,
      winningPath: blueLeftPath,
    });

    const branchLeft = Array.from(
      { length: 10 },
      (_, index) => 15 + index * 11,
    );
    const branchRight = Array.from(
      { length: 10 },
      (_, index) => 16 + index * 11,
    );
    const tiedBranches = stateWithOwners([5, ...branchLeft, ...branchRight]);
    expect(getOutcome(tiedBranches)).toEqual({
      type: "WIN",
      reason: "CONNECTION",
      winnerSlotId: playerBlue,
      winningPath: [5, ...branchLeft],
    });
  });

  it("treats resignation plus an existing connection as an internal invariant failure", () => {
    expect(() =>
      getOutcome(stateWithOwners(blueLeftPath, [], playerRed)),
    ).toThrow(/resignation and connection coexist/u);
  });
});

describe("serialization, projection, and seeded determinism", () => {
  it("keeps Config, State, Action, View, and Outcome JSON-safe with strict schemas", () => {
    const action: HexAction = { type: "PLACE_STONE", cell: 60 };
    const state = stateWithOwners(blueLeftPath);
    const outcome = getOutcome(state);
    const view = projectView({
      state,
      viewer: { kind: "player", slotId: playerBlue },
    });
    expect(hexConfigSchema.safeParse(null).success).toBe(true);
    expect(hexStateSchema.safeParse(state).success).toBe(true);
    expect(hexActionSchema.safeParse(action).success).toBe(true);
    expect(hexViewSchema.safeParse(view).success).toBe(true);
    expect(hexOutcomeSchema.safeParse(outcome).success).toBe(true);
    for (const value of [null, state, action, view, outcome]) {
      expect(isJsonValue(value)).toBe(true);
      expect(JSON.parse(JSON.stringify(value)) as unknown).toEqual(value);
    }
  });

  it("projects fresh public Views for both players and spectators without Core-only fields", () => {
    const { state } = play([60, 59, 71]);
    const viewers: readonly Viewer[] = [
      { kind: "player", slotId: playerBlue },
      { kind: "player", slotId: playerRed },
      { kind: "spectator" },
    ];
    const views = viewers.map((viewer) => projectView({ state, viewer }));
    expect(views.map((view) => view.yourColor)).toEqual(["BLUE", "RED", null]);
    expect({ ...views[0], yourColor: null }).toEqual(views[2]);
    expect({ ...views[1], yourColor: null }).toEqual(views[2]);
    expect(views[0]).not.toBe(state);
    expect(views[0]?.board).not.toBe(state.board);
    expect(views[0]).not.toHaveProperty("nextPlayerIndex");
    expect(views[0]).not.toHaveProperty("resignedSlotId");
    expect(views[0]).not.toHaveProperty("rng");
    expect(JSON.stringify(views)).not.toContain("hex-play");
  });

  it("repeats deeply equal State, View, Outcome, and zero RNG cursor", () => {
    const sequence = [0, 1, 11, 2, 22, 3, 33];
    const first = play(sequence, "hex-repeatable");
    const second = play(sequence, "hex-repeatable");
    expect(first).toEqual(second);
    expect(getOutcome(first.state)).toEqual(getOutcome(second.state));
    expect(
      projectView({
        state: first.state,
        viewer: { kind: "player", slotId: playerBlue },
      }),
    ).toEqual(
      projectView({
        state: second.state,
        viewer: { kind: "player", slotId: playerBlue },
      }),
    );
    expect(first.rng.cursor).toBe(0);
  });
});
