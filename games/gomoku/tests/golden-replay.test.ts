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

import { gomokuDefinition, gomokuDefinitionV1_0_0 } from "../src/core/index.js";

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

const fixtureUrl = new URL("./fixtures/gomoku-1.0.0-win.json", import.meta.url);
const fixtureText = readFileSync(fixtureUrl, "utf8");
const goldenReplay = JSON.parse(fixtureText) as CanonicalReplay;
const currentWinReplay = JSON.parse(
  readFileSync(
    new URL("./fixtures/gomoku-1.1.0-win.json", import.meta.url),
    "utf8",
  ),
) as CanonicalReplay;
const currentResignationReplay = JSON.parse(
  readFileSync(
    new URL("./fixtures/gomoku-1.1.0-resignation.json", import.meta.url),
    "utf8",
  ),
) as CanonicalReplay;
const erasedDefinitions = [
  eraseGameDefinition(gomokuDefinitionV1_0_0),
  eraseGameDefinition(gomokuDefinition),
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

describe("Gomoku 1.0.0 golden replay", () => {
  it("rebuilds deeply equal Config, State, Outcome, and zero RNG cursor repeatedly", () => {
    const first = verifyReplay(goldenReplay, exactResolver);
    const second = verifyReplay(cloneReplay(), exactResolver);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: {
        type: "WIN",
        winnerSlotId: "player-black",
        winningCells: [105, 106, 107, 108, 109],
      },
      state: {
        config: { boardSize: 15, winLength: 5 },
        nextPlayerIndex: 1,
      },
    });
    if (first.status !== "verified") return;
    const state = first.state as {
      readonly board: readonly (string | null)[];
    };
    expect(state.board).toHaveLength(225);
    expect(state.board.slice(0, 4)).toEqual([
      "player-white",
      "player-white",
      "player-white",
      "player-white",
    ]);
    expect(state.board.slice(105, 110)).toEqual([
      "player-black",
      "player-black",
      "player-black",
      "player-black",
      "player-black",
    ]);
    expect(first.state).not.toHaveProperty("resignedSlotId");
  });

  it("requires the exact game and version", () => {
    const unknown = cloneReplay();
    unknown.header.gameVersion = "1.0.1";
    expectInvalid(unknown, "UNKNOWN_GAME_OR_VERSION");
  });

  it("rejects invalid Config, sequence gaps, invalid actions, and Core-rejected history", () => {
    const invalidConfig = cloneReplay();
    invalidConfig.header.initialConfig = { boardSize: 17, winLength: 5 };
    expectInvalid(invalidConfig, "INVALID_CONFIG");

    const gap = cloneReplay();
    const secondAction = gap.actions[1];
    if (secondAction === undefined) throw new Error("Golden action missing.");
    secondAction.sequence = 3;
    expectInvalid(gap, "SEQUENCE_MISMATCH");

    const invalidAction = cloneReplay();
    const firstAction = invalidAction.actions[0];
    if (firstAction === undefined) throw new Error("Golden action missing.");
    firstAction.action = { type: "PLACE_STONE", cell: 361 };
    expectInvalid(invalidAction, "INVALID_ACTION");

    const wrongTurn = cloneReplay();
    const wrongTurnAction = wrongTurn.actions[0];
    if (wrongTurnAction === undefined)
      throw new Error("Golden action missing.");
    wrongTurnAction.actorSlotId = "player-white";
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

describe("Gomoku 1.1.0 golden replays", () => {
  it("keeps normal play deterministic", () => {
    expect(verifyReplay(currentWinReplay, exactResolver)).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      state: {
        config: { boardSize: 15, winLength: 5 },
        resignedSlotId: null,
      },
      outcome: {
        type: "WIN",
        winnerSlotId: "player-black",
        winningCells: [105, 106, 107, 108, 109],
      },
    });
  });

  it("rebuilds an accepted off-turn resignation exactly", () => {
    expect(currentResignationReplay.actions).toEqual([
      {
        sequence: 1,
        actorSlotId: "player-black",
        action: { type: "PLACE_STONE", cell: 180 },
      },
      {
        sequence: 2,
        actorSlotId: "player-black",
        action: { type: "RESIGN" },
      },
    ]);
    expect(verifyReplay(currentResignationReplay, exactResolver)).toMatchObject(
      {
        status: "verified",
        rng: { cursor: 0 },
        state: {
          config: { boardSize: 19, winLength: 5 },
          nextPlayerIndex: 1,
          resignedSlotId: "player-black",
        },
        outcome: {
          type: "WIN",
          reason: "RESIGNATION",
          winnerSlotId: "player-white",
          resignedSlotId: "player-black",
        },
      },
    );
  });

  it("keeps resignation unavailable to the frozen 1.0.0 schema", () => {
    expect(
      gomokuDefinitionV1_0_0.actionSchema.safeParse({ type: "RESIGN" }).success,
    ).toBe(false);
    expect(
      gomokuDefinition.actionSchema.safeParse({ type: "RESIGN" }).success,
    ).toBe(true);
    expect(gomokuDefinitionV1_0_0).not.toBe(gomokuDefinition);
  });
});
