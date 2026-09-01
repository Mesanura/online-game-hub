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

import {
  connectFourDefinition,
  connectFourDefinitionV1_0_0,
} from "../src/core/index.js";

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
  "./fixtures/connect-four-1.0.0-win.json",
  import.meta.url,
);
const fixtureText = readFileSync(fixtureUrl, "utf8");
const goldenReplay = JSON.parse(fixtureText) as CanonicalReplay;
const currentWinReplay = JSON.parse(
  readFileSync(
    new URL("./fixtures/connect-four-1.1.0-win.json", import.meta.url),
    "utf8",
  ),
) as CanonicalReplay;
const currentResignationReplay = JSON.parse(
  readFileSync(
    new URL("./fixtures/connect-four-1.1.0-resignation.json", import.meta.url),
    "utf8",
  ),
) as CanonicalReplay;
const erasedDefinitions = [
  eraseGameDefinition(connectFourDefinitionV1_0_0),
  eraseGameDefinition(connectFourDefinition),
];
const exactResolver: GameDefinitionResolver = (gameId, gameVersion) =>
  erasedDefinitions.find(
    (definition) =>
      definition.manifest.id === gameId &&
      definition.manifest.gameVersion === gameVersion,
  );

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

describe("Connect Four 1.0.0 golden replay", () => {
  it("rebuilds deeply equal State, Outcome, and zero RNG cursor repeatedly", () => {
    const first = verifyReplay(goldenReplay, exactResolver);
    const second = verifyReplay(cloneReplay(), exactResolver);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: {
        type: "WIN",
        winnerSlotId: "player-red",
        winningCells: [35, 36, 37, 38],
      },
      state: {
        board: [
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          "player-yellow",
          "player-yellow",
          "player-yellow",
          null,
          null,
          null,
          null,
          "player-red",
          "player-red",
          "player-red",
          "player-red",
          null,
          null,
          null,
        ],
      },
    });
    if (first.status === "verified") {
      expect(first.state).not.toHaveProperty("resignedSlotId");
    }
  });

  it("requires the exact game and version", () => {
    const unknown = cloneReplay();
    unknown.header.gameVersion = "1.0.1";
    expectInvalid(unknown, "UNKNOWN_GAME_OR_VERSION");
  });

  it("rejects sequence gaps, invalid actions, and Core-rejected history", () => {
    const gap = cloneReplay();
    const secondAction = gap.actions[1];
    if (secondAction === undefined) throw new Error("Golden action missing.");
    secondAction.sequence = 3;
    expectInvalid(gap, "SEQUENCE_MISMATCH");

    const invalidAction = cloneReplay();
    const firstAction = invalidAction.actions[0];
    if (firstAction === undefined) throw new Error("Golden action missing.");
    firstAction.action = { type: "DROP_DISC", column: 7 };
    expectInvalid(invalidAction, "INVALID_ACTION");

    const wrongTurn = cloneReplay();
    const wrongTurnAction = wrongTurn.actions[0];
    if (wrongTurnAction === undefined)
      throw new Error("Golden action missing.");
    wrongTurnAction.actorSlotId = "player-yellow";
    expectInvalid(wrongTurn, "ACTION_REJECTED");
  });

  it("rejects cursor, Outcome, and replay envelope mismatches", () => {
    const cursor = cloneReplay();
    cursor.recordedRngCursor = 1;
    expectInvalid(cursor, "RNG_CURSOR_MISMATCH");

    const outcome = cloneReplay();
    outcome.recordedOutcome = { type: "DRAW" };
    expectInvalid(outcome, "OUTCOME_MISMATCH");

    const format = cloneReplay();
    format.header.replayFormatVersion = 2;
    expectInvalid(format, "UNSUPPORTED_REPLAY_FORMAT");
  });
});

describe("Connect Four 1.1.0 golden replays", () => {
  it("keeps normal play deterministic", () => {
    expect(verifyReplay(currentWinReplay, exactResolver)).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      state: { resignedSlotId: null },
      outcome: {
        type: "WIN",
        winnerSlotId: "player-red",
        winningCells: [35, 36, 37, 38],
      },
    });
  });

  it("rebuilds an accepted off-turn resignation exactly", () => {
    expect(currentResignationReplay.actions).toEqual([
      {
        sequence: 1,
        actorSlotId: "player-red",
        action: { type: "DROP_DISC", column: 3 },
      },
      {
        sequence: 2,
        actorSlotId: "player-red",
        action: { type: "RESIGN" },
      },
    ]);
    expect(verifyReplay(currentResignationReplay, exactResolver)).toMatchObject(
      {
        status: "verified",
        rng: { cursor: 0 },
        state: {
          nextPlayerIndex: 1,
          resignedSlotId: "player-red",
        },
        outcome: {
          type: "WIN",
          reason: "RESIGNATION",
          winnerSlotId: "player-yellow",
          resignedSlotId: "player-red",
        },
      },
    );
  });

  it("keeps resignation unavailable to the frozen 1.0.0 schema", () => {
    expect(
      connectFourDefinitionV1_0_0.actionSchema.safeParse({ type: "RESIGN" })
        .success,
    ).toBe(false);
    expect(
      connectFourDefinition.actionSchema.safeParse({ type: "RESIGN" }).success,
    ).toBe(true);
    expect(connectFourDefinitionV1_0_0).not.toBe(connectFourDefinition);
  });
});
