import { describe, expect, it } from "vitest";
import {
  projectMatchHistoryResult,
  resolveGameHistoryProjection,
} from "../src/history.js";
import {
  resolveGameDefinition,
  resolveRealtimeGameDefinition,
} from "../src/server.js";

const versions = [
  ["tic-tac-toe", ["1.0.0", "1.1.0"]],
  ["connect-four", ["1.0.0", "1.1.0"]],
  ["gomoku", ["1.0.0", "1.1.0"]],
  ["hex", ["1.0.0"]],
  ["reversi", ["1.0.0", "1.1.0"]],
  ["chinese-checkers", ["1.0.0", "1.1.0"]],
  ["pong", ["1.0.0", "1.1.0", "1.2.0"]],
  ["badminton", ["1.0.0", "1.1.0", "1.2.0"]],
  ["tank-maze", ["1.0.0", "1.1.0", "1.2.0"]],
] as const;
const context = {
  gameId: "tic-tac-toe",
  gameVersion: "1.0.0",
  status: "completed",
  recordedOutcome: { type: "DRAW" },
  players: [{ slotId: "a", participantRef: "private" }, { slotId: "b" }],
  playerSlotId: "a",
};

describe("exact history registration", () => {
  it.each(versions)(
    "registers supported %s versions with existing Core definitions",
    (gameId, gameVersions) => {
      for (const gameVersion of gameVersions) {
        expect(
          resolveGameDefinition(gameId, gameVersion) ??
            resolveRealtimeGameDefinition(gameId, gameVersion),
        ).toBeDefined();
        expect(resolveGameHistoryProjection(gameId, gameVersion)).toBeDefined();
      }
      expect(resolveGameHistoryProjection(gameId, "99.0.0")).toBeUndefined();
    },
  );
  it("returns only the projected result, independent of playback availability", () => {
    expect(projectMatchHistoryResult(context)).toEqual({
      kind: "win-loss",
      value: "draw",
    });
    expect(
      projectMatchHistoryResult({
        ...context,
        gameId: "pong",
        gameVersion: "1.0.0",
        recordedOutcome: {
          type: "WIN",
          reason: "SCORE",
          winnerSlotId: "b",
          scores: [1, 3],
        },
      }),
    ).toEqual({ kind: "score", own: 1, opponent: 3 });
  });
  it("fails closed for incomplete, unsupported, missing and malformed inputs", () => {
    for (const status of ["waiting", "active", "abandoned"])
      expect(projectMatchHistoryResult({ ...context, status })).toBeNull();
    for (const players of [
      null,
      [],
      [null],
      [{ slotId: 1 }],
      [{ slotId: "a" }, { slotId: "a" }],
    ])
      expect(projectMatchHistoryResult({ ...context, players })).toBeNull();
    expect(
      projectMatchHistoryResult({ ...context, gameVersion: "99.0.0" }),
    ).toBeNull();
    expect(
      projectMatchHistoryResult({ ...context, gameId: "missing" }),
    ).toBeNull();
    expect(
      projectMatchHistoryResult({ ...context, recordedOutcome: null }),
    ).toBeNull();
    expect(
      projectMatchHistoryResult({ ...context, playerSlotId: "outsider" }),
    ).toBeNull();
  });
});
