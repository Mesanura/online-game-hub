import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_GAME_ACTION_BYTES = 16_384;
export const GAME_ROOM_NAME = "game" as const;
export const GAME_ACTION_MESSAGE = "game.action" as const;
export const ROOM_CONTROL_MESSAGE = "room.control" as const;
export const SERVER_PROTOCOL_MESSAGE = "protocol" as const;
export const GAME_SERVER_TICKET_AUDIENCE = "game-server" as const;

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
    roundNumber: roundNumberSchema.optional(),
    expectedRevision: revisionSchema,
    action: gameActionPayloadSchema,
  })
  .strict();
export type GameActionCommand = z.infer<typeof gameActionCommandSchema>;

export const roomControlOperationSchema = z.enum([
  "REQUEST_REMATCH",
  "CANCEL_REMATCH",
  "CLOSE_ROOM",
]);
export type RoomControlOperation = z.infer<typeof roomControlOperationSchema>;

export const roomControlCommandSchema = z
  .object({
    type: z.literal("room.control"),
    protocolVersion: protocolVersionSchema,
    commandId: commandIdSchema,
    operation: roomControlOperationSchema,
  })
  .strict();
export type RoomControlCommand = z.infer<typeof roomControlCommandSchema>;

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
    roundNumber: roundNumberSchema,
    isOwner: z.boolean(),
    rematch: z
      .object({
        available: z.boolean(),
        selfReady: z.boolean(),
        readyPlayerCount: z.number().int().nonnegative(),
        requiredPlayerCount: z.number().int().positive(),
      })
      .strict(),
    closed: z.boolean(),
    closeReason: roomCloseReasonSchema.nullable(),
    causedByCommandId: commandIdSchema.optional(),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.rematch.readyPlayerCount > state.rematch.requiredPlayerCount) {
      context.addIssue({
        code: "custom",
        message: "Ready player count cannot exceed the required count.",
        path: ["rematch", "readyPlayerCount"],
      });
    }
    if (state.rematch.selfReady && state.rematch.readyPlayerCount === 0) {
      context.addIssue({
        code: "custom",
        message: "A ready viewer must be included in the ready count.",
        path: ["rematch", "selfReady"],
      });
    }
    if (
      !state.rematch.available &&
      (state.rematch.selfReady || state.rematch.readyPlayerCount !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Unavailable rematch state cannot contain ready players.",
        path: ["rematch"],
      });
    }
    if (state.closed !== (state.closeReason !== null)) {
      context.addIssue({
        code: "custom",
        message: "Closed state and close reason must be consistent.",
        path: ["closeReason"],
      });
    }
    if (state.closed && state.rematch.available) {
      context.addIssue({
        code: "custom",
        message: "A closed room cannot offer a rematch.",
        path: ["rematch", "available"],
      });
    }
  });
export type RoomLifecycleState = z.infer<typeof roomLifecycleStateSchema>;

export const gameServerTicketClaimsSchema = z
  .object({
    issuer: z.string().min(1).max(128),
    audience: z.literal(GAME_SERVER_TICKET_AUDIENCE),
    playerSessionId: z.string().min(1).max(128),
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
    roundNumber: roundNumberSchema.optional(),
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
