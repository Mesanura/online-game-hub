import { describe, expect, expectTypeOf, it } from "vitest";

import {
  GAME_ACTION_MESSAGE,
  GAME_ROOM_NAME,
  MAX_GAME_ACTION_BYTES,
  MAX_GAME_SETUP_ACTION_BYTES,
  MAX_REALTIME_INPUT_BYTES,
  SETUP_PROTOCOL_VERSION,
  REALTIME_INPUT_MESSAGE,
  REALTIME_PROTOCOL_VERSION,
  REALTIME_SERVER_MESSAGE,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  gameServerTicketClaimsV6Schema,
  commandIdSchema,
  commandRejectedV6Schema,
  clientMessageV6Schema,
  createGameRoomRequestV6Schema,
  gameActionCommandV6Schema,
  gameSetupCommandSchema,
  joinGameRoomRequestV6Schema,
  matchSnapshotV6Schema,
  realtimeInputCommandSchema,
  realtimeRejectedSchema,
  realtimeServerMessageSchema,
  realtimeSnapshotSchema,
  roomControlCommandV6Schema,
  roomDiscoveryQuerySchema,
  roomDiscoverySchema,
  roomLifecycleStateV6Schema,
  roomConnectedV6Schema,
  serverMessageV6Schema,
} from "../src/index.js";
import type {
  GameActionCommandV6,
  MatchSnapshotV6,
  ProtocolErrorCode,
} from "../src/index.js";

const actionCommand = {
  type: "game.action",
  protocolVersion: SETUP_PROTOCOL_VERSION,
  commandId: "command-1",
  roundNumber: 1,
  expectedRevision: 0,
  action: { type: "PLACE_MARK", cell: 4 },
} as const;

const snapshot = {
  type: "match.snapshot",
  protocolVersion: SETUP_PROTOCOL_VERSION,
  gameId: "tic-tac-toe",
  gameVersion: "1.0.0",
  roundNumber: 1,
  revision: 1,
  status: "active",
  viewer: { kind: "player", slotId: "player-1" },
  view: { board: [null, null, null] },
  outcome: null,
  causedByCommandId: "command-1",
} as const;

describe("transport conventions", () => {
  it("keeps V6 room and custom message names stable", () => {
    expect(SETUP_PROTOCOL_VERSION).toBe(6);
    expect(GAME_ROOM_NAME).toBe("game");
    expect(GAME_ACTION_MESSAGE).toBe("game.action");
    expect(ROOM_CONTROL_MESSAGE).toBe("room.control");
    expect(SERVER_PROTOCOL_MESSAGE).toBe("protocol");
  });
});

const lifecycle = {
  type: "room.lifecycle",
  protocolVersion: SETUP_PROTOCOL_VERSION,
  isOwner: true,
  currentRound: { roundNumber: 1, status: "completed" },
  nextRound: {
    roundNumber: 2,
    setupRevision: 3,
    setupView: { starter: "slot-2", targetScore: 5 },
    readiness: {
      canReady: true,
      selfReady: true,
      readySlotIds: ["slot-1"],
      requiredSlotIds: ["slot-1", "slot-2"],
    },
  },
  players: [
    { slotId: "slot-1", occupied: true, online: true, ready: true },
    { slotId: "slot-2", occupied: true, online: true, ready: false },
  ],
  closed: false,
  closeReason: null,
} as const;

describe("Protocol V6 game-defined setup", () => {
  it("rejects retired generations instead of negotiating or downgrading", () => {
    expect(roomLifecycleStateV6Schema.parse(lifecycle)).toEqual(lifecycle);
    for (const protocolVersion of [1, 2, 3, 4, 5, 7]) {
      expect(
        roomLifecycleStateV6Schema.safeParse({ ...lifecycle, protocolVersion })
          .success,
      ).toBe(false);
      expect(
        gameActionCommandV6Schema.safeParse({
          ...actionCommand,
          protocolVersion,
        }).success,
      ).toBe(false);
      expect(
        matchSnapshotV6Schema.safeParse({ ...snapshot, protocolVersion })
          .success,
      ).toBe(false);
    }
  });

  it("accepts opaque setup intent without identity or authoritative data", () => {
    const command = {
      type: "game.setup",
      protocolVersion: SETUP_PROTOCOL_VERSION,
      commandId: "setup-1",
      roundNumber: 2,
      expectedSetupRevision: 3,
      action: { type: "SELECT_STARTER", choice: "RANDOM" },
    } as const;
    expect(gameSetupCommandSchema.parse(command)).toEqual(command);
    expect(clientMessageV6Schema.parse(command)).toEqual(command);

    for (const forged of [
      { actorSlotId: "slot-2" },
      { state: { secret: true } },
      { rng: { seed: "secret" } },
      { outcome: { type: "WIN" } },
    ]) {
      expect(
        gameSetupCommandSchema.safeParse({ ...command, ...forged }).success,
      ).toBe(false);
    }
  });

  it("rejects oversized setup actions and inconsistent readiness", () => {
    expect(
      gameSetupCommandSchema.safeParse({
        type: "game.setup",
        protocolVersion: SETUP_PROTOCOL_VERSION,
        commandId: "large-setup",
        roundNumber: 1,
        expectedSetupRevision: 0,
        action: { data: "x".repeat(MAX_GAME_SETUP_ACTION_BYTES + 1) },
      }).success,
    ).toBe(false);
    expect(
      roomLifecycleStateV6Schema.safeParse({
        ...lifecycle,
        nextRound: {
          ...lifecycle.nextRound,
          readiness: {
            ...lifecycle.nextRound.readiness,
            readySlotIds: ["slot-3"],
          },
        },
      }).success,
    ).toBe(false);
  });
});

describe("Realtime Protocol V1", () => {
  const realtimeSnapshot = {
    type: "realtime.snapshot",
    realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
    gameId: "pong",
    gameVersion: "1.0.0",
    roundNumber: 1,
    tick: 42,
    viewer: { kind: "player", slotId: "slot-1" },
    view: { ball: { x: 100, y: 200 } },
    outcome: null,
    acknowledgedInputSequence: 3,
  } as const;

  it("keeps realtime messages separate from Protocol V6 envelopes", () => {
    expect(REALTIME_PROTOCOL_VERSION).toBe(1);
    expect(REALTIME_INPUT_MESSAGE).toBe("realtime.input");
    expect(REALTIME_SERVER_MESSAGE).toBe("realtime");
    expect(realtimeSnapshotSchema.parse(realtimeSnapshot)).toEqual(
      realtimeSnapshot,
    );
    expect(realtimeServerMessageSchema.parse(realtimeSnapshot)).toEqual(
      realtimeSnapshot,
    );
    expect(serverMessageV6Schema.safeParse(realtimeSnapshot).success).toBe(
      false,
    );
  });

  it("accepts only minimal direction intent metadata", () => {
    const command = {
      type: "realtime.input",
      realtimeProtocolVersion: 1,
      commandId: "input-1",
      roundNumber: 1,
      inputSequence: 1,
      input: { type: "DIRECTION", direction: -1 },
    };
    expect(realtimeInputCommandSchema.parse(command)).toEqual(command);
    for (const forged of [
      { actor: "slot-2" },
      { slotId: "slot-2" },
      { tick: 100 },
      { state: {} },
      { score: [9, 0] },
      { outcome: { type: "WIN" } },
      { clientTime: 123 },
    ]) {
      expect(
        realtimeInputCommandSchema.safeParse({ ...command, ...forged }).success,
      ).toBe(false);
    }
    expect(
      realtimeInputCommandSchema.safeParse({
        ...command,
        inputSequence: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects oversized input and strict invalid server payloads", () => {
    expect(
      realtimeInputCommandSchema.safeParse({
        type: "realtime.input",
        realtimeProtocolVersion: 1,
        commandId: "large",
        roundNumber: 1,
        inputSequence: 1,
        input: { data: "x".repeat(MAX_REALTIME_INPUT_BYTES + 1) },
      }).success,
    ).toBe(false);
    expect(
      realtimeSnapshotSchema.safeParse({
        ...realtimeSnapshot,
        viewer: { kind: "spectator" },
      }).success,
    ).toBe(false);
    expect(
      realtimeRejectedSchema.parse({
        type: "realtime.rejected",
        realtimeProtocolVersion: 1,
        commandId: "input-1",
        code: "STALE_INPUT_SEQUENCE",
        retryable: false,
        acknowledgedInputSequence: 3,
        snapshot: realtimeSnapshot,
      }),
    ).toMatchObject({ code: "STALE_INPUT_SEQUENCE" });
  });
});

describe("room control", () => {
  it("accepts only platform readiness and close controls", () => {
    for (const operation of [
      "READY_FOR_ROUND",
      "CANCEL_ROUND_READY",
      "CLOSE_ROOM",
    ] as const) {
      expect(
        roomControlCommandV6Schema.parse({
          type: "room.control",
          protocolVersion: SETUP_PROTOCOL_VERSION,
          commandId: `control-${operation}`,
          operation,
        }),
      ).toMatchObject({ operation });
    }
    expect(
      roomControlCommandV6Schema.safeParse({
        type: "room.control",
        protocolVersion: SETUP_PROTOCOL_VERSION,
        commandId: "forged-control",
        operation: "CLOSE_ROOM",
        playerSessionId: "another-player",
      }).success,
    ).toBe(false);
    expect(
      roomControlCommandV6Schema.safeParse({
        type: "room.control",
        protocolVersion: SETUP_PROTOCOL_VERSION,
        commandId: "invalid-starter",
        operation: "SELECT_STARTER",
        starter: "SPECTATOR",
      }).success,
    ).toBe(false);
  });

  it("validates projected lifecycle without exposing session identity", () => {
    const parsed = roomLifecycleStateV6Schema.parse(lifecycle);
    expect(parsed.nextRound?.readiness.selfReady).toBe(true);
    expect(parsed).not.toHaveProperty("playerSessionId");
    expect(JSON.stringify(parsed)).not.toContain("another-player");
  });

  it.each([
    {
      ...lifecycle,
      nextRound: {
        ...lifecycle.nextRound,
        readiness: {
          ...lifecycle.nextRound.readiness,
          readySlotIds: ["slot-1", "slot-2", "slot-3"],
        },
      },
    },
    { ...lifecycle, currentRound: { roundNumber: 1, status: "active" } },
    { ...lifecycle, closed: true, closeReason: null, nextRound: null },
    { ...lifecycle, nextRound: { ...lifecycle.nextRound, roundNumber: 3 } },
    { ...lifecycle, nextRound: null },
    { ...lifecycle, closed: true, closeReason: "OWNER_CLOSED" },
    {
      ...lifecycle,
      nextRound: {
        ...lifecycle.nextRound,
        readiness: {
          ...lifecycle.nextRound.readiness,
          requiredSlotIds: ["slot-1", "slot-1"],
        },
      },
    },
  ])("rejects inconsistent V6 lifecycle state %#", (candidate) => {
    expect(roomLifecycleStateV6Schema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    "SELECT_STARTER",
    "SELECT_PLAYER_COUNT",
    "SELECT_PLAYER_ASSIGNMENT",
    "CLEAR_PLAYER_ASSIGNMENT",
    "START_REMATCH",
  ])("rejects removed platform operation %s in every envelope", (operation) => {
    for (const protocolVersion of [5, 6]) {
      expect(
        roomControlCommandV6Schema.safeParse({
          type: "room.control",
          protocolVersion,
          commandId: "obsolete-control",
          operation,
        }).success,
      ).toBe(false);
    }
  });
});

describe("GameActionCommandV6", () => {
  it("parses a strict V6 envelope and keeps action unknown", () => {
    const parsed = gameActionCommandV6Schema.parse(actionCommand);
    expect(parsed).toEqual(actionCommand);
    expectTypeOf<GameActionCommandV6["action"]>().toBeUnknown();
    expect(
      gameActionCommandV6Schema.safeParse({
        type: actionCommand.type,
        protocolVersion: actionCommand.protocolVersion,
        commandId: actionCommand.commandId,
        expectedRevision: actionCommand.expectedRevision,
        action: actionCommand.action,
      }).success,
    ).toBe(false);
  });

  it.each([
    [{ ...actionCommand, protocolVersion: 3 }],
    [{ ...actionCommand, expectedRevision: -1 }],
    [{ ...actionCommand, expectedRevision: 1.5 }],
    [{ ...actionCommand, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...actionCommand, roundNumber: 0 }],
    [{ ...actionCommand, type: "game.move" }],
    [{ ...actionCommand, actorSlotId: "player-2" }],
    [{ ...actionCommand, state: { board: [] } }],
  ])("rejects unsupported or forged envelope %#", (candidate) => {
    expect(gameActionCommandV6Schema.safeParse(candidate).success).toBe(false);
  });

  it("rejects a missing action and non-JSON action", () => {
    const missingAction = {
      type: actionCommand.type,
      protocolVersion: actionCommand.protocolVersion,
      commandId: actionCommand.commandId,
      expectedRevision: actionCommand.expectedRevision,
    };
    expect(gameActionCommandV6Schema.safeParse(missingAction).success).toBe(
      false,
    );
    const { roundNumber, ...missingRoundNumber } = actionCommand;
    expect(roundNumber).toBe(1);
    expect(
      gameActionCommandV6Schema.safeParse(missingRoundNumber).success,
    ).toBe(false);
    expect(
      gameActionCommandV6Schema.safeParse({
        ...actionCommand,
        action: { value: undefined },
      }).success,
    ).toBe(false);
  });

  it("rejects oversized action JSON", () => {
    const oversized = "x".repeat(MAX_GAME_ACTION_BYTES);
    expect(
      gameActionCommandV6Schema.safeParse({
        ...actionCommand,
        action: { oversized },
      }).success,
    ).toBe(false);
  });
});

describe("server envelopes", () => {
  it("round trips a complete per-viewer snapshot", () => {
    const parsed = matchSnapshotV6Schema.parse(
      JSON.parse(JSON.stringify(snapshot)) as unknown,
    );
    expect(parsed).toEqual(snapshot);
    expectTypeOf<MatchSnapshotV6>().toMatchTypeOf(parsed);
  });

  it.each([
    [{ ...snapshot, protocolVersion: 0 }],
    [{ ...snapshot, revision: -1 }],
    [{ ...snapshot, roundNumber: 0 }],
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
    expect(matchSnapshotV6Schema.safeParse(candidate).success).toBe(false);
  });

  it("requires a round number in every snapshot", () => {
    const { roundNumber, ...missingRoundNumber } = snapshot;
    expect(roundNumber).toBe(1);
    expect(matchSnapshotV6Schema.safeParse(missingRoundNumber).success).toBe(
      false,
    );
  });

  it("parses platform and game-rule rejection without conflating codes", () => {
    const parsed = commandRejectedV6Schema.parse({
      type: "command.rejected",
      protocolVersion: SETUP_PROTOCOL_VERSION,
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
      serverMessageV6Schema.safeParse({
        type: "server.error",
        protocolVersion: SETUP_PROTOCOL_VERSION,
      }).success,
    ).toBe(false);
    expect(
      commandRejectedV6Schema.safeParse({
        type: "command.rejected",
        protocolVersion: SETUP_PROTOCOL_VERSION,
        code: "UNKNOWN_ERROR",
        retryable: false,
      }).success,
    ).toBe(false);
    expect(
      commandRejectedV6Schema.safeParse({
        type: "command.rejected",
        protocolVersion: SETUP_PROTOCOL_VERSION,
        code: "INTERNAL_ERROR",
        retryable: false,
        stack: "secret",
      }).success,
    ).toBe(false);
  });
});

describe("ticket and room matchmaking contracts", () => {
  const claims = {
    issuer: "test-web",
    audience: "game-server",
    playerSessionId: "session-a",
    issuedAt: 100,
    expiresAt: 130,
    ticketId: "ticket-a",
    protocolVersion: SETUP_PROTOCOL_VERSION,
  } as const;

  it("parses strict ticket claims and rejects incompatible claims", () => {
    expect(gameServerTicketClaimsV6Schema.parse(claims)).toEqual(claims);
    for (const protocolVersion of [1, 2, 3, 4, 5, 7]) {
      expect(
        gameServerTicketClaimsV6Schema.safeParse({ ...claims, protocolVersion })
          .success,
      ).toBe(false);
    }
    expect(
      gameServerTicketClaimsV6Schema.parse({
        ...claims,
        userId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toMatchObject({ userId: "11111111-1111-4111-8111-111111111111" });
    expect(
      gameServerTicketClaimsV6Schema.safeParse({
        ...claims,
        audience: "another-service",
      }).success,
    ).toBe(false);
    expect(
      gameServerTicketClaimsV6Schema.safeParse({
        ...claims,
        protocolVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      gameServerTicketClaimsV6Schema.safeParse({
        ...claims,
        expiresAt: claims.issuedAt,
      }).success,
    ).toBe(false);
    expect(
      gameServerTicketClaimsV6Schema.safeParse({
        ...claims,
        userId: "forged-user-id",
      }).success,
    ).toBe(false);
    expect(
      gameServerTicketClaimsV6Schema.safeParse({
        ...claims,
        userId: "11111111-1111-4111-8111-111111111111",
        role: "admin",
      }).success,
    ).toBe(false);
  });

  it("accepts create/join intent without client-selected version, slot, or room id", () => {
    expect(
      createGameRoomRequestV6Schema.parse({
        type: "room.create",
        protocolVersion: SETUP_PROTOCOL_VERSION,
        ticket: "opaque-ticket",
        gameId: "tic-tac-toe",
        initialConfig: null,
      }),
    ).toEqual({
      type: "room.create",
      protocolVersion: SETUP_PROTOCOL_VERSION,
      ticket: "opaque-ticket",
      gameId: "tic-tac-toe",
      initialConfig: null,
    });

    expect(
      joinGameRoomRequestV6Schema.parse({
        type: "room.join",
        protocolVersion: SETUP_PROTOCOL_VERSION,
        ticket: "opaque-ticket",
        roomCode: " abcd2345 ",
      }).roomCode,
    ).toBe("ABCD2345");

    for (const forbidden of [
      { gameVersion: "1.0.0" },
      { playerSlotId: "slot-2" },
      { roomId: "internal-room" },
    ]) {
      expect(
        createGameRoomRequestV6Schema.safeParse({
          type: "room.create",
          protocolVersion: SETUP_PROTOCOL_VERSION,
          ticket: "opaque-ticket",
          gameId: "tic-tac-toe",
          initialConfig: null,
          ...forbidden,
        }).success,
      ).toBe(false);
    }
  });

  it("discovers only exact non-sensitive room generation metadata", () => {
    expect(
      roomDiscoveryQuerySchema.parse({
        gameId: "tic-tac-toe",
        roomCode: " abcd2345 ",
      }),
    ).toEqual({ gameId: "tic-tac-toe", roomCode: "ABCD2345" });
    const discovery = {
      roomCode: "ABCD2345",
      gameId: "tic-tac-toe",
      gameVersion: "1.1.0",
      setupProtocol: SETUP_PROTOCOL_VERSION,
      runtime: "turn-based",
    } as const;
    expect(roomDiscoverySchema.parse(discovery)).toEqual(discovery);
    expect(
      roomDiscoverySchema.safeParse({ ...discovery, playerSessionId: "secret" })
        .success,
    ).toBe(false);
  });

  it("round trips the public room connection response without internal ids", () => {
    const connected = roomConnectedV6Schema.parse({
      type: "room.connected",
      protocolVersion: SETUP_PROTOCOL_VERSION,
      roomCode: "ABCD2345",
      gameId: "tic-tac-toe",
      gameVersion: "1.0.0",
      playerSlotId: "slot-1",
    });
    expect(serverMessageV6Schema.parse(connected)).toEqual(connected);
    expect(connected).not.toHaveProperty("roomId");
    expect(commandIdSchema.safeParse("x".repeat(129)).success).toBe(false);
  });
});
