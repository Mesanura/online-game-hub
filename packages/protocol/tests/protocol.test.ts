import { describe, expect, expectTypeOf, it } from "vitest";

import {
  MAX_GAME_ACTION_BYTES,
  PROTOCOL_VERSION,
  commandRejectedSchema,
  gameActionCommandSchema,
  matchSnapshotSchema,
  serverMessageSchema,
} from "../src/index.js";
import type {
  GameActionCommand,
  MatchSnapshot,
  ProtocolErrorCode,
} from "../src/index.js";

const actionCommand = {
  type: "game.action",
  protocolVersion: PROTOCOL_VERSION,
  commandId: "command-1",
  expectedRevision: 0,
  action: { type: "PLACE_MARK", cell: 4 },
} as const;

const snapshot = {
  type: "match.snapshot",
  protocolVersion: PROTOCOL_VERSION,
  gameId: "tic-tac-toe",
  gameVersion: "1.0.0",
  revision: 1,
  status: "active",
  viewer: { kind: "player", slotId: "player-1" },
  view: { board: [null, null, null] },
  outcome: null,
  causedByCommandId: "command-1",
} as const;

describe("GameActionCommand", () => {
  it("parses a strict V1 envelope and keeps action unknown", () => {
    const parsed = gameActionCommandSchema.parse(actionCommand);
    expect(parsed).toEqual(actionCommand);
    expectTypeOf<GameActionCommand["action"]>().toBeUnknown();
  });

  it.each([
    [{ ...actionCommand, protocolVersion: 2 }],
    [{ ...actionCommand, expectedRevision: -1 }],
    [{ ...actionCommand, expectedRevision: 1.5 }],
    [{ ...actionCommand, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...actionCommand, type: "game.move" }],
    [{ ...actionCommand, actorSlotId: "player-2" }],
    [{ ...actionCommand, state: { board: [] } }],
  ])("rejects unsupported or forged envelope %#", (candidate) => {
    expect(gameActionCommandSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects a missing action and non-JSON action", () => {
    const missingAction = {
      type: actionCommand.type,
      protocolVersion: actionCommand.protocolVersion,
      commandId: actionCommand.commandId,
      expectedRevision: actionCommand.expectedRevision,
    };
    expect(gameActionCommandSchema.safeParse(missingAction).success).toBe(
      false,
    );
    expect(
      gameActionCommandSchema.safeParse({
        ...actionCommand,
        action: { value: undefined },
      }).success,
    ).toBe(false);
  });

  it("rejects oversized action JSON", () => {
    const oversized = "x".repeat(MAX_GAME_ACTION_BYTES);
    expect(
      gameActionCommandSchema.safeParse({
        ...actionCommand,
        action: { oversized },
      }).success,
    ).toBe(false);
  });
});

describe("server envelopes", () => {
  it("round trips a complete per-viewer snapshot", () => {
    const parsed = matchSnapshotSchema.parse(
      JSON.parse(JSON.stringify(snapshot)) as unknown,
    );
    expect(parsed).toEqual(snapshot);
    expectTypeOf<MatchSnapshot>().toMatchTypeOf(parsed);
  });

  it.each([
    [{ ...snapshot, protocolVersion: 0 }],
    [{ ...snapshot, revision: -1 }],
    [{ ...snapshot, type: "match.patch" }],
    [{ ...snapshot, state: { secret: true } }],
    [{ ...snapshot, rng: { seed: "secret" } }],
    [
      {
        ...snapshot,
        viewer: { kind: "player", slotId: "player-1", ticket: "secret" },
      },
    ],
  ])("rejects invalid or private snapshot field %#", (candidate) => {
    expect(matchSnapshotSchema.safeParse(candidate).success).toBe(false);
  });

  it("parses platform and game-rule rejection without conflating codes", () => {
    const parsed = commandRejectedSchema.parse({
      type: "command.rejected",
      protocolVersion: PROTOCOL_VERSION,
      commandId: "command-1",
      code: "GAME_RULE_REJECTED",
      revision: 1,
      gameRuleCode: "CELL_OCCUPIED",
      retryable: false,
      snapshot,
    });
    expect(parsed.code).toBe("GAME_RULE_REJECTED");
    expect(parsed.gameRuleCode).toBe("CELL_OCCUPIED");
    expectTypeOf(parsed.code).toEqualTypeOf<ProtocolErrorCode>();
  });

  it("rejects unknown discriminators, error codes, and diagnostic leaks", () => {
    expect(
      serverMessageSchema.safeParse({
        type: "server.error",
        protocolVersion: PROTOCOL_VERSION,
      }).success,
    ).toBe(false);
    expect(
      commandRejectedSchema.safeParse({
        type: "command.rejected",
        protocolVersion: PROTOCOL_VERSION,
        code: "UNKNOWN_ERROR",
        retryable: false,
      }).success,
    ).toBe(false);
    expect(
      commandRejectedSchema.safeParse({
        type: "command.rejected",
        protocolVersion: PROTOCOL_VERSION,
        code: "INTERNAL_ERROR",
        retryable: false,
        stack: "secret",
      }).success,
    ).toBe(false);
  });
});
