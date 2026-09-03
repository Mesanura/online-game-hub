import { z } from "zod";

export const PROTOCOL_VERSION = 5 as const;
export const MAX_GAME_ACTION_BYTES = 16_384;
export const GAME_ROOM_NAME = "game" as const;
export const GAME_ACTION_MESSAGE = "game.action" as const;
export const ROOM_CONTROL_MESSAGE = "room.control" as const;
export const SERVER_PROTOCOL_MESSAGE = "protocol" as const;
export const GAME_SERVER_TICKET_AUDIENCE = "game-server" as const;
export const REALTIME_PROTOCOL_VERSION = 1 as const;
export const REALTIME_INPUT_MESSAGE = "realtime.input" as const;
export const REALTIME_SERVER_MESSAGE = "realtime" as const;
export const MAX_REALTIME_INPUT_BYTES = 1_024;

const GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const EXACT_SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function isJsonValueInternal(
  value: unknown,
  ancestors: WeakSet<object>,
): boolean {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "object" || ancestors.has(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    return false;
  }

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValueInternal(entry, ancestors))
    : Object.values(value).every((entry) =>
        isJsonValueInternal(entry, ancestors),
      );
  ancestors.delete(value);
  return valid;
}

function isJsonValue(value: unknown): boolean {
  return isJsonValueInternal(value, new WeakSet<object>());
}

function utf8Length(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      length += 1;
    } else if (codeUnit <= 0x7ff) {
      length += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length
    ) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        length += 4;
        index += 1;
      } else {
        length += 3;
      }
    } else {
      length += 3;
    }
  }
  return length;
}

function isActionPayload(value: unknown): boolean {
  if (!isJsonValue(value)) {
    return false;
  }

  const serialized = JSON.stringify(value);
  return (
    serialized !== undefined && utf8Length(serialized) <= MAX_GAME_ACTION_BYTES
  );
}

function isRealtimeInputPayload(value: unknown): boolean {
  if (!isJsonValue(value)) return false;
  const serialized = JSON.stringify(value);
  return (
    serialized !== undefined &&
    utf8Length(serialized) <= MAX_REALTIME_INPUT_BYTES
  );
}

export const protocolVersionSchema = z.literal(PROTOCOL_VERSION);
export const revisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const roundNumberSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
export const commandIdSchema = z.string().min(1).max(128);
export const gameIdSchema = z.string().regex(GAME_ID_PATTERN);
export const gameVersionSchema = z.string().regex(EXACT_SEMVER_PATTERN);
export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{8}$/u);
export const gameServerTicketSchema = z.string().min(1).max(4096);
export const jsonValueSchema = z.custom<unknown>(isJsonValue, {
  error: "Expected a JSON-serializable value.",
});
export const gameActionPayloadSchema = z.custom<unknown>(isActionPayload, {
  error: "Action must be JSON-serializable and at most 16384 UTF-8 bytes.",
});

export const viewerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("player"),
      slotId: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("spectator") }).strict(),
]);
export type Viewer = z.infer<typeof viewerSchema>;

export const matchStatusSchema = z.enum([
  "waiting",
  "active",
  "completed",
  "abandoned",
]);
export type MatchStatus = z.infer<typeof matchStatusSchema>;

export const gameActionCommandSchema = z
  .object({
    type: z.literal("game.action"),
    protocolVersion: protocolVersionSchema,
    commandId: commandIdSchema,
    roundNumber: roundNumberSchema,
    expectedRevision: revisionSchema,
    action: gameActionPayloadSchema,
  })
  .strict();
export type GameActionCommand = z.infer<typeof gameActionCommandSchema>;

export const starterChoiceSchema = z.enum(["OWNER", "NON_OWNER", "RANDOM"]);
export type StarterChoice = z.infer<typeof starterChoiceSchema>;
export const playerCountSchema = z.number().int().min(2).max(6);
export const assignmentSchema = z.string().min(1).max(64);

const roomControlBaseSchema = z.object({
  type: z.literal("room.control"),
  protocolVersion: protocolVersionSchema,
  commandId: commandIdSchema,
});

export const roomControlCommandSchema = z.discriminatedUnion("operation", [
  roomControlBaseSchema
    .extend({
      operation: z.literal("SELECT_STARTER"),
      starter: starterChoiceSchema,
    })
    .strict(),
  roomControlBaseSchema
    .extend({ operation: z.literal("READY_FOR_ROUND") })
    .strict(),
  roomControlBaseSchema
    .extend({ operation: z.literal("CANCEL_ROUND_READY") })
    .strict(),
  roomControlBaseSchema
    .extend({ operation: z.literal("START_REMATCH") })
    .strict(),
  roomControlBaseSchema.extend({ operation: z.literal("CLOSE_ROOM") }).strict(),
  roomControlBaseSchema
    .extend({
      operation: z.literal("SELECT_PLAYER_COUNT"),
      playerCount: playerCountSchema,
    })
    .strict(),
  roomControlBaseSchema
    .extend({
      operation: z.literal("SELECT_PLAYER_ASSIGNMENT"),
      assignment: assignmentSchema,
    })
    .strict(),
  roomControlBaseSchema
    .extend({ operation: z.literal("CLEAR_PLAYER_ASSIGNMENT") })
    .strict(),
]);
export type RoomControlCommand = z.infer<typeof roomControlCommandSchema>;
export type RoomControlOperation = RoomControlCommand["operation"];

const currentRoundLifecycleSchema = z
  .object({
    roundNumber: roundNumberSchema,
    status: z.enum(["active", "completed", "abandoned"]),
  })
  .strict();

const nextRoundLifecycleSchema = z
  .object({
    roundNumber: roundNumberSchema,
    starter: starterChoiceSchema.nullable(),
    selfReady: z.boolean(),
    readyPlayerCount: z.number().int().nonnegative(),
    requiredPlayerCount: z.number().int().min(2).max(6),
    assignmentOptions: z.array(assignmentSchema).optional(),
  })
  .strict();

const lifecyclePlayerSchema = z
  .object({
    slotId: z.string().min(1),
    occupied: z.boolean(),
    online: z.boolean(),
    ready: z.boolean(),
    assignment: assignmentSchema.nullable(),
  })
  .strict();

export const roomCloseReasonSchema = z.enum([
  "OWNER_CLOSED",
  "PLAYER_LEFT",
  "RECONNECT_TIMEOUT",
  "REMATCH_TIMEOUT",
]);
export type RoomCloseReason = z.infer<typeof roomCloseReasonSchema>;

export const roomLifecycleStateSchema = z
  .object({
    type: z.literal("room.lifecycle"),
    protocolVersion: protocolVersionSchema,
    isOwner: z.boolean(),
    currentRound: currentRoundLifecycleSchema.nullable(),
    nextRound: nextRoundLifecycleSchema.nullable(),
    closed: z.boolean(),
    closeReason: roomCloseReasonSchema.nullable(),
    players: z.array(lifecyclePlayerSchema).min(1).max(6).optional(),
    causedByCommandId: commandIdSchema.optional(),
  })
  .strict()
  .superRefine((state, context) => {
    const nextRound = state.nextRound;
    if (
      nextRound !== null &&
      nextRound.readyPlayerCount > nextRound.requiredPlayerCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Ready player count cannot exceed the required count.",
        path: ["nextRound", "readyPlayerCount"],
      });
    }
    if (nextRound?.selfReady === true && nextRound.readyPlayerCount === 0) {
      context.addIssue({
        code: "custom",
        message: "A ready viewer must be included in the ready count.",
        path: ["nextRound", "selfReady"],
      });
    }
    if (
      nextRound !== null &&
      nextRound.starter === null &&
      (nextRound.selfReady || nextRound.readyPlayerCount !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "A round without a starter cannot contain ready players.",
        path: ["nextRound"],
      });
    }
    if (state.closed !== (state.closeReason !== null)) {
      context.addIssue({
        code: "custom",
        message: "Closed state and close reason must be consistent.",
        path: ["closeReason"],
      });
    }
    if (state.closed && nextRound !== null) {
      context.addIssue({
        code: "custom",
        message: "A closed room cannot offer a next round.",
        path: ["nextRound"],
      });
    }
    if (
      !state.closed &&
      nextRound === null &&
      state.currentRound?.status !== "active"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "An open room without an active round must offer a next round.",
        path: ["nextRound"],
      });
    }
    if (state.currentRound?.status === "active" && nextRound !== null) {
      context.addIssue({
        code: "custom",
        message: "An active round cannot offer a next round.",
        path: ["nextRound"],
      });
    }
    if (
      nextRound !== null &&
      nextRound.roundNumber !== (state.currentRound?.roundNumber ?? 0) + 1
    ) {
      context.addIssue({
        code: "custom",
        message: "The next round number must follow the current round.",
        path: ["nextRound", "roundNumber"],
      });
    }
  });
export type RoomLifecycleState = z.infer<typeof roomLifecycleStateSchema>;

export const gameServerTicketClaimsSchema = z
  .object({
    issuer: z.string().min(1).max(128),
    audience: z.literal(GAME_SERVER_TICKET_AUDIENCE),
    playerSessionId: z.string().min(1).max(128),
    userId: z.uuid().optional(),
    issuedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ticketId: z.string().min(1).max(128),
    protocolVersion: protocolVersionSchema,
  })
  .strict()
  .refine((claims) => claims.expiresAt > claims.issuedAt, {
    error: "Ticket expiry must be after issue time.",
    path: ["expiresAt"],
  });
export type GameServerTicketClaims = z.infer<
  typeof gameServerTicketClaimsSchema
>;

export const createGameRoomRequestSchema = z
  .object({
    type: z.literal("room.create"),
    protocolVersion: protocolVersionSchema,
    ticket: gameServerTicketSchema,
    gameId: gameIdSchema,
    initialConfig: jsonValueSchema,
  })
  .strict();
export type CreateGameRoomRequest = z.infer<typeof createGameRoomRequestSchema>;

export const joinGameRoomRequestSchema = z
  .object({
    type: z.literal("room.join"),
    protocolVersion: protocolVersionSchema,
    ticket: gameServerTicketSchema,
    roomCode: roomCodeSchema,
  })
  .strict();
export type JoinGameRoomRequest = z.infer<typeof joinGameRoomRequestSchema>;

export const gameRoomRequestSchema = z.discriminatedUnion("type", [
  createGameRoomRequestSchema,
  joinGameRoomRequestSchema,
]);
export type GameRoomRequest = z.infer<typeof gameRoomRequestSchema>;

export const roomConnectedSchema = z
  .object({
    type: z.literal("room.connected"),
    protocolVersion: protocolVersionSchema,
    roomCode: roomCodeSchema,
    gameId: gameIdSchema,
    gameVersion: gameVersionSchema,
    playerSlotId: z.string().min(1),
  })
  .strict();
export type RoomConnected = z.infer<typeof roomConnectedSchema>;

export const matchSnapshotSchema = z
  .object({
    type: z.literal("match.snapshot"),
    protocolVersion: protocolVersionSchema,
    gameId: gameIdSchema,
    gameVersion: gameVersionSchema,
    roundNumber: roundNumberSchema,
    revision: revisionSchema,
    status: matchStatusSchema,
    viewer: viewerSchema,
    view: jsonValueSchema,
    outcome: jsonValueSchema.nullable(),
    causedByCommandId: commandIdSchema.optional(),
  })
  .strict();

type InferredMatchSnapshot = z.infer<typeof matchSnapshotSchema>;
export type MatchSnapshot<View = unknown, Outcome = unknown> = Omit<
  InferredMatchSnapshot,
  "outcome" | "view"
> & {
  readonly view: View;
  readonly outcome: Outcome | null;
};

export const protocolErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "PROTOCOL_VERSION_UNSUPPORTED",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "ROOM_NOT_JOINABLE",
  "ROOM_CONTROL_NOT_ALLOWED",
  "NOT_A_PLAYER",
  "MATCH_NOT_ACTIVE",
  "STALE_REVISION",
  "INVALID_ACTION_PAYLOAD",
  "GAME_RULE_REJECTED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);
export type ProtocolErrorCode = z.infer<typeof protocolErrorCodeSchema>;

export const commandRejectedSchema = z
  .object({
    type: z.literal("command.rejected"),
    protocolVersion: protocolVersionSchema,
    commandId: commandIdSchema.optional(),
    code: protocolErrorCodeSchema,
    revision: revisionSchema.optional(),
    gameRuleCode: z.string().min(1).optional(),
    retryable: z.boolean(),
    snapshot: matchSnapshotSchema.optional(),
  })
  .strict();

type InferredCommandRejected = z.infer<typeof commandRejectedSchema>;
export type CommandRejected = Omit<InferredCommandRejected, "snapshot"> & {
  readonly snapshot?: MatchSnapshot;
};

export const clientMessageSchema = z.discriminatedUnion("type", [
  gameActionCommandSchema,
  roomControlCommandSchema,
]);
export const serverMessageSchema = z.discriminatedUnion("type", [
  roomConnectedSchema,
  matchSnapshotSchema,
  commandRejectedSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const realtimeProtocolVersionSchema = z.literal(
  REALTIME_PROTOCOL_VERSION,
);
export const inputSequenceSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
export const acknowledgedInputSequenceSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const realtimeInputPayloadSchema = z.custom<unknown>(
  isRealtimeInputPayload,
  {
    error:
      "Realtime input must be JSON-serializable and at most 1024 UTF-8 bytes.",
  },
);

export const realtimeInputCommandSchema = z
  .object({
    type: z.literal("realtime.input"),
    realtimeProtocolVersion: realtimeProtocolVersionSchema,
    commandId: commandIdSchema,
    roundNumber: roundNumberSchema,
    inputSequence: inputSequenceSchema,
    input: realtimeInputPayloadSchema,
  })
  .strict();
export type RealtimeInputCommand = z.infer<typeof realtimeInputCommandSchema>;

export const realtimeSnapshotSchema = z
  .object({
    type: z.literal("realtime.snapshot"),
    realtimeProtocolVersion: realtimeProtocolVersionSchema,
    gameId: gameIdSchema,
    gameVersion: gameVersionSchema,
    roundNumber: roundNumberSchema,
    tick: revisionSchema,
    viewer: z
      .object({ kind: z.literal("player"), slotId: z.string().min(1) })
      .strict(),
    view: jsonValueSchema,
    outcome: jsonValueSchema.nullable(),
    acknowledgedInputSequence: acknowledgedInputSequenceSchema,
  })
  .strict();
type InferredRealtimeSnapshot = z.infer<typeof realtimeSnapshotSchema>;
export type RealtimeSnapshot<View = unknown, Outcome = unknown> = Omit<
  InferredRealtimeSnapshot,
  "outcome" | "view"
> & {
  readonly view: View;
  readonly outcome: Outcome | null;
};

export const realtimeErrorCodeSchema = z.enum([
  "NOT_A_PLAYER",
  "MATCH_NOT_ACTIVE",
  "ROUND_MISMATCH",
  "INVALID_INPUT_PAYLOAD",
  "STALE_INPUT_SEQUENCE",
  "DUPLICATE_COMMAND",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);
export type RealtimeErrorCode = z.infer<typeof realtimeErrorCodeSchema>;

export const realtimeRejectedSchema = z
  .object({
    type: z.literal("realtime.rejected"),
    realtimeProtocolVersion: realtimeProtocolVersionSchema,
    commandId: commandIdSchema.optional(),
    code: realtimeErrorCodeSchema,
    retryable: z.boolean(),
    acknowledgedInputSequence: acknowledgedInputSequenceSchema.optional(),
    snapshot: realtimeSnapshotSchema.optional(),
  })
  .strict();
type InferredRealtimeRejected = z.infer<typeof realtimeRejectedSchema>;
export type RealtimeRejected = Omit<InferredRealtimeRejected, "snapshot"> & {
  readonly snapshot?: RealtimeSnapshot;
};

export const realtimeServerMessageSchema = z.discriminatedUnion("type", [
  realtimeSnapshotSchema,
  realtimeRejectedSchema,
]);
export type RealtimeServerMessage = z.infer<typeof realtimeServerMessageSchema>;
