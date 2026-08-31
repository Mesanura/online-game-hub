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

import { hexDefinition } from "../src/core/index.js";

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

const fixtureUrl = new URL("./fixtures/hex-1.0.0-win.json", import.meta.url);
const fixtureText = readFileSync(fixtureUrl, "utf8");
const goldenReplay = JSON.parse(fixtureText) as CanonicalReplay;
const erasedDefinition = eraseGameDefinition(hexDefinition);
const exactResolver: GameDefinitionResolver = (gameId, gameVersion) =>
  gameId === hexDefinition.manifest.id &&
  gameVersion === hexDefinition.manifest.gameVersion
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

describe("Hex 1.0.0 golden replay", () => {
  it("rebuilds deeply equal State, connection Outcome, path, and zero RNG cursor repeatedly", () => {
    const first = verifyReplay(goldenReplay, exactResolver);
    const second = verifyReplay(cloneReplay(), exactResolver);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: {
        type: "WIN",
        reason: "CONNECTION",
        winnerSlotId: "player-blue",
        winningPath: [0, 11, 22, 33, 44, 55, 66, 77, 88, 99, 110],
      },
      state: {
        nextPlayerIndex: 1,
        resignedSlotId: null,
      },
    });
    if (first.status !== "verified") return;
    const state = first.state as { readonly board: readonly (string | null)[] };
    expect(state.board).toHaveLength(121);
    expect(state.board.filter((owner) => owner === "player-blue")).toHaveLength(
      11,
    );
    expect(state.board.filter((owner) => owner === "player-red")).toHaveLength(
      10,
    );
  });

  it("requires the exact game/version and null canonical Config", () => {
    const version = cloneReplay();
    version.header.gameVersion = "1.0.1";
    expectInvalid(version, "UNKNOWN_GAME_OR_VERSION");

    const game = cloneReplay();
    game.header.gameId = "gomoku";
    expectInvalid(game, "UNKNOWN_GAME_OR_VERSION");

    const config = cloneReplay();
    config.header.initialConfig = {};
    expectInvalid(config, "INVALID_CONFIG");
  });

  it("rejects sequence, actor, Action, envelope, cursor, Outcome, and path mutations", () => {
    const sequence = cloneReplay();
    const second = sequence.actions[1];
    if (second === undefined) throw new Error("Golden action missing.");
    second.sequence = 3;
    expectInvalid(sequence, "SEQUENCE_MISMATCH");

    const actor = cloneReplay();
    const firstActor = actor.actions[0];
    if (firstActor === undefined) throw new Error("Golden action missing.");
    firstActor.actorSlotId = "player-red";
    expectInvalid(actor, "ACTION_REJECTED");

    const action = cloneReplay();
    const firstAction = action.actions[0];
    if (firstAction === undefined) throw new Error("Golden action missing.");
    firstAction.action = { type: "PLACE_STONE", cell: 121 };
    expectInvalid(action, "INVALID_ACTION");

    const extra = cloneReplay();
    const extraAction = extra.actions[0];
    if (extraAction === undefined) throw new Error("Golden action missing.");
    extraAction.action = {
      type: "PLACE_STONE",
      cell: 0,
      actorSlotId: "player-blue",
    };
    expectInvalid(extra, "INVALID_ACTION");

    const format = cloneReplay();
    format.header.replayFormatVersion = 2;
    expectInvalid(format, "UNSUPPORTED_REPLAY_FORMAT");

    const cursor = cloneReplay();
    cursor.recordedRngCursor = 1;
    expectInvalid(cursor, "RNG_CURSOR_MISMATCH");

    const outcome = cloneReplay();
    outcome.recordedOutcome = {
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: "player-blue",
      resignedSlotId: "player-red",
    };
    expectInvalid(outcome, "OUTCOME_MISMATCH");

    const path = cloneReplay();
    path.recordedOutcome = {
      type: "WIN",
      reason: "CONNECTION",
      winnerSlotId: "player-blue",
      winningPath: [0, 11, 22, 33, 44, 55, 66, 77, 88, 100, 110],
    };
    expectInvalid(path, "OUTCOME_MISMATCH");
  });
});
