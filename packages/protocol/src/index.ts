import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_GAME_ACTION_BYTES = 16_384;

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
export const commandIdSchema = z.string().min(1).max(128);
export const gameIdSchema = z.string().regex(GAME_ID_PATTERN);
export const gameVersionSchema = z.string().regex(EXACT_SEMVER_PATTERN);
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
    expectedRevision: revisionSchema,
    action: gameActionPayloadSchema,
  })
  .strict();
export type GameActionCommand = z.infer<typeof gameActionCommandSchema>;

export const matchSnapshotSchema = z
  .object({
    type: z.literal("match.snapshot"),
    protocolVersion: protocolVersionSchema,
    gameId: gameIdSchema,
    gameVersion: gameVersionSchema,
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
]);
export const serverMessageSchema = z.discriminatedUnion("type", [
  matchSnapshotSchema,
  commandRejectedSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
