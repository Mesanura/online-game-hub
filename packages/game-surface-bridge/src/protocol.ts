import { z } from "zod";

export const SURFACE_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const SURFACE_BRIDGE_V1 = 1 as const;
export const SURFACE_BRIDGE_V2 = 2 as const;
export const SURFACE_BRIDGE_VERSION = SURFACE_BRIDGE_V2;
export const SURFACE_HANDSHAKE_MESSAGE = "game-surface-handshake" as const;
export const SURFACE_READY_TIMEOUT_MS = 10_000;

export const surfaceBridgeVersionSchema = z.union([
  z.literal(SURFACE_BRIDGE_V1),
  z.literal(SURFACE_BRIDGE_V2),
]);
export type SurfaceBridgeVersion = z.infer<typeof surfaceBridgeVersionSchema>;

const GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const EXACT_SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const ENTRYPOINT_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.html$/u;
const CONTENT_DIGEST_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/u;

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
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
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

export const surfaceJsonValueSchema = z.custom<unknown>(
  (value) => isJsonValueInternal(value, new WeakSet<object>()),
  { error: "Expected a JSON-serializable value." },
);

const FORBIDDEN_SURFACE_KEYS = new Set([
  "actor",
  "actorSlotId",
  "authoritativeState",
  "canonicalReplay",
  "commandId",
  "inputSequence",
  "playerSessionId",
  "rawState",
  "replayId",
  "rng",
  "rngState",
  "seed",
  "session",
  "sessionId",
  "ticket",
  "userId",
]);

function containsForbiddenSurfaceKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenSurfaceKey(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, child]) =>
        FORBIDDEN_SURFACE_KEYS.has(key) || containsForbiddenSurfaceKey(child),
    );
  }
  return false;
}

export const surfaceSafeValueSchema = surfaceJsonValueSchema.refine(
  (value) => !containsForbiddenSurfaceKey(value),
  { error: "Surface data contains a forbidden platform field." },
);
export const surfaceProjectedValueSchema = surfaceSafeValueSchema;

export const surfaceModeSchema = z.enum(["setup", "play", "replay"]);
export type SurfaceMode = z.infer<typeof surfaceModeSchema>;

export const surfacePlatformControlSchema = z.enum(["RESIGN"]);
export type SurfacePlatformControl = z.infer<
  typeof surfacePlatformControlSchema
>;

export const surfaceArtifactManifestV1Schema = z
  .object({
    schemaVersion: z.literal(SURFACE_ARTIFACT_SCHEMA_VERSION),
    gameId: z.string().regex(GAME_ID_PATTERN),
    supportedGameVersions: z
      .array(z.string().regex(EXACT_SEMVER_PATTERN))
      .min(1)
      .refine((versions) => new Set(versions).size === versions.length, {
        error: "Supported game versions must be unique.",
      }),
    surfaceVersion: z.string().regex(EXACT_SEMVER_PATTERN),
    bridgeVersion: surfaceBridgeVersionSchema,
    entrypoints: z
      .object({
        setup: z.string().regex(ENTRYPOINT_PATTERN),
        play: z.string().regex(ENTRYPOINT_PATTERN),
        replay: z.string().regex(ENTRYPOINT_PATTERN).optional(),
      })
      .strict(),
    capabilities: z
      .object({
        pointerLock: z.boolean().optional(),
        webAssembly: z.boolean().optional(),
        worker: z.boolean().optional(),
      })
      .strict(),
    contentDigest: z.string().regex(CONTENT_DIGEST_PATTERN),
  })
  .strict();
export type SurfaceArtifactManifestV1 = z.infer<
  typeof surfaceArtifactManifestV1Schema
>;

export const hostHandshakeSchema = z
  .object({
    type: z.literal("host.hello"),
    bridgeVersion: surfaceBridgeVersionSchema,
    nonce: z.string().min(32).max(256),
    mode: surfaceModeSchema,
  })
  .strict();
export const surfaceHandshakeSchema = z
  .object({
    type: z.literal("surface.ready"),
    bridgeVersion: surfaceBridgeVersionSchema,
    nonce: z.string().min(32).max(256),
  })
  .strict();

const connectionStateSchema = z.enum([
  "idle",
  "loading",
  "connecting",
  "connected",
  "reconnecting",
  "closed",
]);

const hostSurfaceMessageVariants = [
  z
    .object({
      type: z.literal("host.init"),
      bridgeVersion: surfaceBridgeVersionSchema,
      mode: surfaceModeSchema,
      gameId: z.string().regex(GAME_ID_PATTERN),
      gameVersion: z.string().regex(EXACT_SEMVER_PATTERN),
      locale: z.string().min(2).max(35),
      reducedMotion: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("host.state"),
      sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      connectionState: connectionStateSchema,
      readOnly: z.boolean(),
      roundNumber: z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .nullable(),
      revision: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
      tick: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
      setupRevision: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
      payload: surfaceProjectedValueSchema,
      outcome: surfaceProjectedValueSchema.nullable().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("host.environment"),
      width: z.number().finite().nonnegative(),
      height: z.number().finite().nonnegative(),
      fullscreen: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("host.intent-result"),
      clientIntentId: z.string().min(1).max(128),
      status: z.enum(["accepted", "rejected", "stale"]),
      code: z.string().min(1).max(128).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("host.command"),
      clientIntentId: z.string().min(1).max(128),
      control: surfacePlatformControlSchema,
    })
    .strict(),
  z.object({ type: z.literal("host.dispose") }).strict(),
] as const;

export const hostSurfaceMessageSchema = z.discriminatedUnion(
  "type",
  hostSurfaceMessageVariants,
);
export type HostSurfaceMessage = z.infer<typeof hostSurfaceMessageSchema>;

const surfaceIntentMessageSchema = z
  .object({
    type: z.literal("surface.intent"),
    clientIntentId: z.string().min(1).max(128),
    intent: surfaceSafeValueSchema,
  })
  .strict();
const surfaceErrorMessageSchema = z
  .object({
    type: z.literal("surface.error"),
    code: z.string().min(1).max(128),
    message: z.string().max(512).optional(),
  })
  .strict();
const surfaceDiagnosticMessageSchema = z
  .object({
    type: z.literal("surface.diagnostic"),
    name: z.string().min(1).max(128),
    value: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
  })
  .strict();

export const surfaceResultToneSchema = z.enum([
  "win",
  "loss",
  "draw",
  "neutral",
]);
export type SurfaceResultTone = z.infer<typeof surfaceResultToneSchema>;

export const surfaceResultSummaryV2Schema = z
  .object({
    type: z.literal("surface.result-summary"),
    stateSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    tone: surfaceResultToneSchema,
    headline: z.string().min(1).max(80),
    details: z.array(z.string().min(1).max(120)).max(6).optional(),
  })
  .strict();
export type SurfaceResultSummaryV2 = z.infer<
  typeof surfaceResultSummaryV2Schema
>;

export const surfaceHostMessageV1Schema = z.discriminatedUnion("type", [
  surfaceIntentMessageSchema,
  surfaceErrorMessageSchema,
  surfaceDiagnosticMessageSchema,
]);
export type SurfaceHostMessageV1 = z.infer<typeof surfaceHostMessageV1Schema>;

export const surfaceHostMessageV2Schema = z.discriminatedUnion("type", [
  surfaceIntentMessageSchema,
  surfaceErrorMessageSchema,
  surfaceDiagnosticMessageSchema,
  surfaceResultSummaryV2Schema,
]);
export type SurfaceHostMessageV2 = z.infer<typeof surfaceHostMessageV2Schema>;

export const surfaceHostMessageSchema = surfaceHostMessageV2Schema;
export type SurfaceHostMessage = SurfaceHostMessageV2;

export function surfaceHostMessageSchemaFor(
  bridgeVersion: SurfaceBridgeVersion,
) {
  return bridgeVersion === SURFACE_BRIDGE_V1
    ? surfaceHostMessageV1Schema
    : surfaceHostMessageV2Schema;
}

export function hostSurfaceMessageMatchesBridgeVersion(
  message: HostSurfaceMessage,
  bridgeVersion: SurfaceBridgeVersion,
): boolean {
  return (
    message.type !== "host.init" || message.bridgeVersion === bridgeVersion
  );
}

export type HostHandshake = z.infer<typeof hostHandshakeSchema>;
export type SurfaceHandshake = z.infer<typeof surfaceHandshakeSchema>;
