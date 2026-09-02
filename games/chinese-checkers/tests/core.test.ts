import {
  createRng,
  definePlayerSlotId,
  isJsonValue,
} from "@online-game-hub/game-sdk";
import { describe, expect, it } from "vitest";

import {
  CHINESE_CHECKERS_CAMP_CELLS,
  CHINESE_CHECKERS_CELL_COUNT,
  adjacentCells,
  createInitialState,
  chineseCheckersActionSchema,
  chineseCheckersStateSchema,
  projectView,
  transition,
} from "../src/core/index.js";

const players = ["p1", "p2", "p3", "p4", "p5", "p6"].map(definePlayerSlotId);
const assignments = ["N", "S", "NE", "SW", "SE", "NW"] as const;

function init(count = 2) {
  return createInitialState({
    config: null,
    players: players.slice(0, count),
    playerAssignments: assignments.slice(0, count),
    rng: createRng("chinese-checkers-test"),
  });
}

describe("Chinese Checkers core", () => {
  it("initializes 2, 3, and 6 players on 73 cells", () => {
    for (const count of [2, 3, 6]) {
      const result = init(count);
      expect(result.state.board).toHaveLength(CHINESE_CHECKERS_CELL_COUNT);
      expect(result.state.board.filter((slot) => slot !== null)).toHaveLength(
        count * 6,
      );
      expect(result.state.players).toHaveLength(count);
      expect(result.rng.cursor).toBe(0);
      expect(isJsonValue(result.state)).toBe(true);
    }
    expect(
      new Set(Object.values(CHINESE_CHECKERS_CAMP_CELLS).flat()).size,
    ).toBe(36);
  });

  it("rejects missing, invalid, and conflicting camp assignments", () => {
    expect(() =>
      createInitialState({
        config: null,
        players: players.slice(0, 2),
        rng: createRng("x"),
      }),
    ).toThrow();
    expect(() =>
      createInitialState({
        config: null,
        players: players.slice(0, 2),
        playerAssignments: ["N", "N"],
        rng: createRng("x"),
      }),
    ).toThrow();
    expect(() =>
      createInitialState({
        config: null,
        players: players.slice(0, 2),
        playerAssignments: ["N", "bad"],
        rng: createRng("x"),
      }),
    ).toThrow();
  });

  it("allows an adjacent move and projects only the viewer camp", () => {
    const initial = init(2);
    const legal = CHINESE_CHECKERS_CAMP_CELLS.N[0];
    if (legal === undefined) throw new Error("Camp cell missing.");
    const target = adjacentCells(legal).find(
      (cell) => initial.state.board[cell] === null,
    );
    expect(target).toBeDefined();
    if (target === undefined || players[0] === undefined)
      throw new Error("Move fixture missing.");
    const moved = transition({
      state: initial.state,
      rng: initial.rng,
      actorSlotId: players[0],
      action: { type: "MOVE_PIECE", from: legal, to: target },
    });
    expect(moved.status).toBe("accepted");
    expect(initial.state.board[legal]).toBe(players[0]);
    const view = projectView({
      state: initial.state,
      viewer: { kind: "player", slotId: players[0] },
    });
    expect(view.yourCamp).toBe("N");
    expect(view.board).toHaveLength(73);
  });

  it("validates strict actions and off-turn/occupied moves", () => {
    expect(
      chineseCheckersActionSchema.safeParse({
        type: "MOVE_PIECE",
        from: 0,
        to: 1,
        actor: "p1",
      }).success,
    ).toBe(false);
    const initial = init(2);
    if (players[1] === undefined) throw new Error("Player fixture missing.");
    expect(
      transition({
        state: initial.state,
        rng: initial.rng,
        actorSlotId: players[1],
        action: { type: "MOVE_PIECE", from: 0, to: 1 },
      }),
    ).toEqual({ status: "rejected", code: "NOT_YOUR_TURN" });
    expect(
      chineseCheckersStateSchema.safeParse({ ...initial.state, board: [] })
        .success,
    ).toBe(false);
  });

  it("finds a continuous jump without mutating the origin state", () => {
    const p1 = players[0];
    const p2 = players[1];
    if (p1 === undefined || p2 === undefined)
      throw new Error("Players missing.");
    const board = Array<(typeof players)[number] | null>(
      CHINESE_CHECKERS_CELL_COUNT,
    ).fill(null);
    for (const cell of [36, 0, 1, 2, 3, 4]) board[cell] = p1;
    for (const cell of [26, 10, 8, 9, 11, 12]) board[cell] = p2;
    const initial = init(2);
    const customState = { ...initial.state, board };
    const moved = transition({
      state: customState,
      rng: initial.rng,
      actorSlotId: p1,
      action: { type: "MOVE_PIECE", from: 36, to: 5 },
    });
    expect(moved.status).toBe("accepted");
    if (moved.status !== "accepted") return;
    expect(moved.state.board[36]).toBeNull();
    expect(moved.state.board[5]).toBe(p1);
    expect(customState.board[36]).toBe(p1);
    expect(customState.board[5]).toBeNull();
  });

  it("locks a player into the ranking when the opposite camp is filled", () => {
    const p1 = players[0];
    const p2 = players[1];
    if (p1 === undefined || p2 === undefined)
      throw new Error("Players missing.");
    const target = [...CHINESE_CHECKERS_CAMP_CELLS.S];
    const missing = target[0];
    if (missing === undefined) throw new Error("Target camp is empty.");
    const source = adjacentCells(missing).find(
      (cell) => !target.includes(cell),
    );
    if (source === undefined) throw new Error("Target has no adjacent source.");
    const board = Array<(typeof players)[number] | null>(
      CHINESE_CHECKERS_CELL_COUNT,
    ).fill(null);
    for (const cell of target.slice(1)) board[cell] = p1;
    board[source] = p1;
    for (const cell of CHINESE_CHECKERS_CAMP_CELLS.NE) board[cell] = p2;
    const initial = init(2);
    const customState = { ...initial.state, board };
    const moved = transition({
      state: customState,
      rng: initial.rng,
      actorSlotId: p1,
      action: { type: "MOVE_PIECE", from: source, to: missing },
    });
    expect(moved.status).toBe("accepted");
    if (moved.status !== "accepted") return;
    expect(moved.state.rankings).toEqual([
      { slotId: p1, rank: 1, reason: "FINISHED" },
      { slotId: p2, rank: 2, reason: "LAST_REMAINING" },
    ]);
    expect(moved.state.nextPlayerIndex).toBe(0);
  });

  it("skips already ranked players while preserving the current player turn", () => {
    const p1 = players[0];
    const p2 = players[1];
    if (p1 === undefined || p2 === undefined)
      throw new Error("Players missing.");
    const initial = init(3);
    const customState = {
      ...initial.state,
      rankings: [{ slotId: p1, rank: 1, reason: "FINISHED" as const }],
      nextPlayerIndex: 1,
    };
    const from = CHINESE_CHECKERS_CAMP_CELLS.S[0];
    if (from === undefined) throw new Error("Source fixture missing.");
    const to = adjacentCells(from).find(
      (cell) => customState.board[cell] === null,
    );
    if (to === undefined) throw new Error("Move fixture missing.");
    const moved = transition({
      state: customState,
      rng: initial.rng,
      actorSlotId: p2,
      action: { type: "MOVE_PIECE", from, to },
    });
    expect(moved.status).toBe("accepted");
    if (moved.status !== "accepted") return;
    expect(moved.state.nextPlayerIndex).toBe(2);
    expect(moved.state.rankings).toEqual([
      { slotId: p1, rank: 1, reason: "FINISHED" },
    ]);
    expect(moved.state.players[moved.state.nextPlayerIndex]?.slotId).toBe(
      players[2],
    );
  });

  it("ranks the last remaining player before resigned players", () => {
    const initial = init(2);
    const p1 = players[0];
    const p2 = players[1];
    if (p1 === undefined || p2 === undefined)
      throw new Error("Players missing.");
    const resigned = transition({
      state: initial.state,
      rng: initial.rng,
      actorSlotId: p1,
      action: { type: "RESIGN" },
    });
    expect(resigned.status).toBe("accepted");
    if (resigned.status !== "accepted") return;
    expect(resigned.state.rankings).toEqual([
      { slotId: p2, rank: 1, reason: "LAST_REMAINING" },
      { slotId: p1, rank: 2, reason: "RESIGNATION" },
    ]);
    expect(
      projectView({
        state: resigned.state,
        viewer: { kind: "player", slotId: p1 },
      }).outcome,
    ).toEqual({
      type: "RANKING",
      rankings: resigned.state.rankings,
    });
  });

  it("rejects invalid player contexts and keeps seeded transitions deterministic", () => {
    const duplicatePlayer = players[0];
    if (duplicatePlayer === undefined) throw new Error("Players missing.");
    expect(() =>
      createInitialState({
        config: null,
        players: [duplicatePlayer, duplicatePlayer],
        playerAssignments: ["N", "S"],
        rng: createRng("invalid"),
      }),
    ).toThrow();
    const left = init(2);
    const right = init(2);
    expect(left.state).toEqual(right.state);
    expect(left.rng).toEqual(right.rng);
    expect(JSON.stringify(left.state)).toBe(JSON.stringify(right.state));
    expect(Object.isFrozen(left.state)).toBe(true);
    expect(Object.isFrozen(left.state.board)).toBe(true);
  });
});
