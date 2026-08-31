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

import { reversiDefinition } from "../src/core/index.js";

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
  "./fixtures/reversi-1.0.0-win.json",
  import.meta.url,
);
const fixtureText = readFileSync(fixtureUrl, "utf8");
const goldenReplay = JSON.parse(fixtureText) as CanonicalReplay;
const erasedDefinition = eraseGameDefinition(reversiDefinition);
const exactResolver: GameDefinitionResolver = (gameId, gameVersion) =>
  gameId === reversiDefinition.manifest.id &&
  gameVersion === reversiDefinition.manifest.gameVersion
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

describe("Reversi 1.0.0 golden replay", () => {
  it("rebuilds the exact full-board State, Outcome, and zero RNG cursor repeatedly", () => {
    const first = verifyReplay(goldenReplay, exactResolver);
    const second = verifyReplay(cloneReplay(), exactResolver);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: {
        type: "WIN",
        winnerSlotId: "player-white",
        discCounts: { BLACK: 19, WHITE: 45 },
      },
      state: { nextPlayerIndex: 1 },
    });
    if (first.status !== "verified") return;
    const state = first.state as {
      readonly board: readonly (string | null)[];
    };
    expect(state.board).toHaveLength(64);
    expect(
      state.board.filter((owner) => owner === "player-black"),
    ).toHaveLength(19);
    expect(
      state.board.filter((owner) => owner === "player-white"),
    ).toHaveLength(45);
  });

  it("records only accepted placements while forced skips retain sequence/revision continuity", () => {
    expect(goldenReplay.actions).toHaveLength(60);
    expect(goldenReplay.actions.map((event) => event.sequence)).toEqual(
      Array.from({ length: 60 }, (_, index) => index + 1),
    );
    expect(goldenReplay.actions.slice(17, 21)).toEqual([
      {
        sequence: 18,
        actorSlotId: "player-white",
        action: { type: "PLACE_DISC", cell: 6 },
      },
      {
        sequence: 19,
        actorSlotId: "player-white",
        action: { type: "PLACE_DISC", cell: 13 },
      },
      {
        sequence: 20,
        actorSlotId: "player-white",
        action: { type: "PLACE_DISC", cell: 20 },
      },
      {
        sequence: 21,
        actorSlotId: "player-white",
        action: { type: "PLACE_DISC", cell: 33 },
      },
    ]);
    expect(
      goldenReplay.actions.some(
        (event) =>
          typeof event.action === "object" &&
          event.action !== null &&
          "type" in event.action &&
          event.action.type === "PASS",
      ),
    ).toBe(false);
  });

  it("requires the exact game/version and null canonical Config", () => {
    const version = cloneReplay();
    version.header.gameVersion = "1.0.1";
    expectInvalid(version, "UNKNOWN_GAME_OR_VERSION");

    const game = cloneReplay();
    game.header.gameId = "hex";
    expectInvalid(game, "UNKNOWN_GAME_OR_VERSION");

    const config = cloneReplay();
    config.header.initialConfig = {};
    expectInvalid(config, "INVALID_CONFIG");
  });

  it("rejects sequence, actor, Action, envelope, cursor, and Outcome mutations", () => {
    const sequence = cloneReplay();
    const second = sequence.actions[1];
    if (second === undefined) throw new Error("Golden action missing.");
    second.sequence = 3;
    expectInvalid(sequence, "SEQUENCE_MISMATCH");

    const actor = cloneReplay();
    const firstActor = actor.actions[0];
    if (firstActor === undefined) throw new Error("Golden action missing.");
    firstActor.actorSlotId = "player-white";
    expectInvalid(actor, "ACTION_REJECTED");

    const action = cloneReplay();
    const firstAction = action.actions[0];
    if (firstAction === undefined) throw new Error("Golden action missing.");
    firstAction.action = { type: "PLACE_DISC", cell: 64 };
    expectInvalid(action, "INVALID_ACTION");

    const pass = cloneReplay();
    const passAction = pass.actions[18];
    if (passAction === undefined) throw new Error("Golden action missing.");
    passAction.action = { type: "PASS" };
    expectInvalid(pass, "INVALID_ACTION");

    const extra = cloneReplay();
    const extraAction = extra.actions[0];
    if (extraAction === undefined) throw new Error("Golden action missing.");
    extraAction.action = {
      type: "PLACE_DISC",
      cell: 19,
      flips: [27],
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
      winnerSlotId: "player-black",
      discCounts: { BLACK: 19, WHITE: 45 },
    };
    expectInvalid(outcome, "OUTCOME_MISMATCH");
  });
});
