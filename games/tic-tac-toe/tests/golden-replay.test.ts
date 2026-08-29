import { readFileSync } from "node:fs";

import { eraseGameDefinition } from "@online-game-hub/game-sdk";
import type { JsonValue } from "@online-game-hub/game-sdk";
import { verifyReplay } from "@online-game-hub/game-server-runtime";
import type {
  CanonicalReplay,
  GameDefinitionResolver,
  ReplayVerificationErrorCode,
} from "@online-game-hub/game-server-runtime";
import { describe, expect, it } from "vitest";

import { ticTacToeDefinition } from "../src/core/index.js";

interface MutableReplay {
  header: {
    replayFormatVersion: number;
    gameId: string;
    gameVersion: string;
    rng: { algorithm: string; seed: string };
    initialConfig: JsonValue;
    players: { slotId: string; participantRef?: string }[];
  };
  actions: {
    sequence: number;
    actorSlotId: string;
    action: JsonValue;
  }[];
  recordedRngCursor: number | null;
  recordedOutcome: JsonValue | null;
}

const fixtureUrl = new URL(
  "./fixtures/tic-tac-toe-1.0.0-win.json",
  import.meta.url,
);
const fixtureText = readFileSync(fixtureUrl, "utf8");
const goldenReplay = JSON.parse(fixtureText) as CanonicalReplay;
const erasedDefinition = eraseGameDefinition(ticTacToeDefinition);
const exactResolver: GameDefinitionResolver = (gameId, gameVersion) =>
  gameId === ticTacToeDefinition.manifest.id &&
  gameVersion === ticTacToeDefinition.manifest.gameVersion
    ? erasedDefinition
    : undefined;

function cloneReplay(): MutableReplay {
  return JSON.parse(fixtureText) as MutableReplay;
}

function expectInvalid(
  replay: unknown,
  code: ReplayVerificationErrorCode,
): void {
  expect(verifyReplay(replay, exactResolver)).toMatchObject({
    status: "invalid",
    code,
  });
}

describe("Tic-Tac-Toe 1.0.0 golden replay", () => {
  it("rebuilds deeply equal State, RNG, and Outcome repeatedly", () => {
    const first = verifyReplay(goldenReplay, exactResolver);
    const second = verifyReplay(cloneReplay(), exactResolver);
    const third = verifyReplay(cloneReplay(), exactResolver);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(first).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: {
        type: "WIN",
        winnerSlotId: "player-x",
        winningCells: [0, 1, 2],
      },
      state: {
        board: [
          "player-x",
          "player-x",
          "player-x",
          "player-o",
          "player-o",
          null,
          null,
          null,
          null,
        ],
      },
    });
  });

  it("rejects unknown exact game and version", () => {
    const unknownGame = cloneReplay();
    unknownGame.header.gameId = "unknown-game";
    expectInvalid(unknownGame, "UNKNOWN_GAME_OR_VERSION");

    const unknownVersion = cloneReplay();
    unknownVersion.header.gameVersion = "1.0.1";
    expectInvalid(unknownVersion, "UNKNOWN_GAME_OR_VERSION");
  });

  it.each([
    { name: "gap", sequence: 3 },
    { name: "duplicate", sequence: 1 },
  ])("rejects a $name in canonical sequence", ({ sequence }) => {
    const replay = cloneReplay();
    const action = replay.actions[1];
    if (action === undefined) {
      throw new Error("Golden fixture must contain a second action.");
    }
    action.sequence = sequence;
    expectInvalid(replay, "SEQUENCE_MISMATCH");
  });

  it("rejects actors outside slots and wrong-turn accepted history", () => {
    const unknownActor = cloneReplay();
    const unknownActorAction = unknownActor.actions[0];
    if (unknownActorAction === undefined) {
      throw new Error("Golden fixture must contain an action.");
    }
    unknownActorAction.actorSlotId = "stranger";
    expectInvalid(unknownActor, "INVALID_ACTOR");

    const wrongActor = cloneReplay();
    const wrongActorAction = wrongActor.actions[0];
    if (wrongActorAction === undefined) {
      throw new Error("Golden fixture must contain an action.");
    }
    wrongActorAction.actorSlotId = "player-o";
    expectInvalid(wrongActor, "ACTION_REJECTED");
  });

  it("rejects schema-invalid payload and Core-rejected history", () => {
    const invalidPayload = cloneReplay();
    const invalidPayloadAction = invalidPayload.actions[0];
    if (invalidPayloadAction === undefined) {
      throw new Error("Golden fixture must contain an action.");
    }
    invalidPayloadAction.action = { type: "PLACE_MARK", cell: 9 };
    expectInvalid(invalidPayload, "INVALID_ACTION");

    const rejectedHistory = cloneReplay();
    const rejectedAction = rejectedHistory.actions[1];
    if (rejectedAction === undefined) {
      throw new Error("Golden fixture must contain a second action.");
    }
    rejectedAction.action = { type: "PLACE_MARK", cell: 0 };
    expectInvalid(rejectedHistory, "ACTION_REJECTED");
  });

  it("rejects RNG cursor and recorded Outcome mismatches", () => {
    const wrongCursor = cloneReplay();
    wrongCursor.recordedRngCursor = 1;
    expectInvalid(wrongCursor, "RNG_CURSOR_MISMATCH");

    const wrongOutcome = cloneReplay();
    wrongOutcome.recordedOutcome = { type: "DRAW" };
    expectInvalid(wrongOutcome, "OUTCOME_MISMATCH");
  });

  it("rejects unsupported replay envelope versions", () => {
    const replay = cloneReplay();
    replay.header.replayFormatVersion = 2;
    expectInvalid(replay, "UNSUPPORTED_REPLAY_FORMAT");
  });
});
