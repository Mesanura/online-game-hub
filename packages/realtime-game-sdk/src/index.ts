import type { ZodType } from "zod";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type RealtimeReplayMode = "none" | "record-only" | "player-playback";

export type RealtimePlayerSlotId = string & {
  readonly __realtimePlayerSlotId: unique symbol;
};

export function defineRealtimePlayerSlotId(
  value: string,
): RealtimePlayerSlotId {
  if (value.length === 0)
    throw new TypeError("Player slot id must not be empty.");
  return value as RealtimePlayerSlotId;
}

export type RealtimeGameId = string & {
  readonly __realtimeGameId: unique symbol;
};
export type RealtimeGameVersion = string & {
  readonly __realtimeGameVersion: unique symbol;
};

const REALTIME_GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const REALTIME_GAME_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export function isRealtimeGameId(value: string): value is RealtimeGameId {
  return REALTIME_GAME_ID_PATTERN.test(value);
}

export function isRealtimeGameVersion(
  value: string,
): value is RealtimeGameVersion {
  return REALTIME_GAME_VERSION_PATTERN.test(value);
}

export function defineRealtimeGameId(value: string): RealtimeGameId {
  if (!isRealtimeGameId(value)) {
    throw new TypeError("Invalid realtime game id.");
  }
  return value as RealtimeGameId;
}

export function defineRealtimeGameVersion(value: string): RealtimeGameVersion {
  if (!isRealtimeGameVersion(value)) {
    throw new TypeError("Invalid realtime game version.");
  }
  return value as RealtimeGameVersion;
}

export interface RealtimeGameManifest {
  readonly runtime: "realtime";
  readonly id: RealtimeGameId;
  readonly gameVersion: RealtimeGameVersion;
  readonly title: string;
  readonly description: string;
  readonly defaultConfig: JsonValue;
  readonly minPlayers: 2;
  readonly maxPlayers: 2;
  readonly tickRate: 60;
  readonly capabilities: {
    readonly hiddenInformation: false;
    readonly deterministicRandomness: true;
    /** Explicit recording/playback support for this exact game version. */
    readonly replay: RealtimeReplayMode;
  };
}

export interface RealtimeRngState {
  readonly algorithm: typeof REALTIME_RNG_ALGORITHM_V1;
  readonly seed: string;
  readonly cursor: number;
}

export const REALTIME_RNG_ALGORITHM_V1 = "fnv1a32-counter-v1" as const;

export function createRealtimeRng(seed: string): RealtimeRngState {
  if (seed.length === 0) throw new TypeError("RNG seed must not be empty.");
  return { algorithm: REALTIME_RNG_ALGORITHM_V1, seed, cursor: 0 };
}

function counterHash(seed: string, cursor: number): number {
  let hash = 0x81_1c_9d_c5;
  const input = seed + "\u0000" + cursor.toString(10);
  for (let index = 0; index < input.length; index += 1) {
    const codeUnit = input.charCodeAt(index);
    hash = Math.imul(hash ^ (codeUnit & 0xff), 0x01_00_01_93);
    hash = Math.imul(hash ^ (codeUnit >>> 8), 0x01_00_01_93);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7f_eb_35_2d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x84_6c_a6_8b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function nextRealtimeInt(
  rng: Readonly<RealtimeRngState>,
  maxExclusive: number,
): { readonly value: number; readonly next: RealtimeRngState } {
  if (
    rng.algorithm !== REALTIME_RNG_ALGORITHM_V1 ||
    rng.seed.length === 0 ||
    !Number.isSafeInteger(rng.cursor) ||
    rng.cursor < 0
  ) {
    throw new TypeError("Invalid realtime RNG state.");
  }
  if (
    !Number.isSafeInteger(maxExclusive) ||
    maxExclusive <= 0 ||
    maxExclusive > 0x1_00_00_00_00
  ) {
    throw new RangeError("maxExclusive must be an integer between 1 and 2^32.");
  }
  const range = 0x1_00_00_00_00;
  const limit = range - (range % maxExclusive);
  let cursor = rng.cursor;
  for (;;) {
    if (cursor >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError("RNG cursor is exhausted.");
    }
    const candidate = counterHash(rng.seed, cursor);
    cursor += 1;
    if (candidate < limit) {
      return {
        value: candidate % maxExclusive,
        next: {
          algorithm: REALTIME_RNG_ALGORITHM_V1,
          seed: rng.seed,
          cursor,
        },
      };
    }
  }
}

export interface RealtimePlayerInput<Input extends JsonValue = JsonValue> {
  readonly slotId: RealtimePlayerSlotId;
  readonly input: Input;
}

export type RealtimeOutcome = JsonValue;

export interface RealtimeGameDefinition<
  Config extends JsonValue,
  State extends JsonValue,
  Input extends JsonValue,
  View extends JsonValue,
  Outcome extends JsonValue,
> {
  readonly manifest: RealtimeGameManifest;
  readonly configSchema: ZodType<Config>;
  readonly inputSchema: ZodType<Input>;
  createInitialState(context: {
    readonly config: Readonly<Config>;
    readonly players: readonly RealtimePlayerSlotId[];
    readonly rng: Readonly<RealtimeRngState>;
  }): { readonly state: State; readonly rng: RealtimeRngState };
  step(context: {
    readonly state: Readonly<State>;
    readonly tick: number;
    readonly inputs: readonly RealtimePlayerInput<Input>[];
    readonly rng: Readonly<RealtimeRngState>;
  }): { readonly state: State; readonly rng: RealtimeRngState };
  projectView(context: {
    readonly state: Readonly<State>;
    readonly viewer: {
      readonly kind: "player";
      readonly slotId: RealtimePlayerSlotId;
    };
  }): View;
  getOutcome(state: Readonly<State>): Outcome | null;
}

export type UnknownRealtimeGameDefinition = RealtimeGameDefinition<
  JsonValue,
  JsonValue,
  JsonValue,
  JsonValue,
  JsonValue
>;

export function eraseRealtimeGameDefinition<
  Config extends JsonValue,
  State extends JsonValue,
  Input extends JsonValue,
  View extends JsonValue,
  Outcome extends JsonValue,
>(
  definition: RealtimeGameDefinition<Config, State, Input, View, Outcome>,
): UnknownRealtimeGameDefinition {
  return definition as unknown as UnknownRealtimeGameDefinition;
}

export interface RealtimeReplayHeader {
  readonly replayFormatVersion: 1;
  readonly runtime: "realtime";
  readonly gameId: string;
  readonly gameVersion: string;
  readonly tickRate: 60;
  readonly rng: { readonly algorithm: string; readonly seed: string };
  readonly initialConfig: JsonValue;
  readonly players: readonly { readonly slotId: string }[];
}

export interface RealtimeReplayEvent {
  readonly sequence: number;
  readonly tick: number;
  readonly actorSlotId: string;
  readonly input: JsonValue;
}

export interface RealtimeCanonicalReplay {
  readonly header: RealtimeReplayHeader;
  readonly events: readonly RealtimeReplayEvent[];
  readonly recordedRngCursor: number | null;
  readonly recordedOutcome: JsonValue | null;
  readonly finalTick: number;
}

export interface RealtimeReplayResult<State extends JsonValue = JsonValue> {
  readonly state: State;
  readonly rng: RealtimeRngState;
  readonly outcome: JsonValue | null;
  readonly finalTick: number;
}

export type RealtimeReplayFailureCode =
  | "INVALID_HEADER"
  | "UNKNOWN_GAME_VERSION"
  | "INVALID_CONFIG"
  | "INVALID_EVENT"
  | "SEQUENCE_GAP"
  | "TICK_ORDER"
  | "UNKNOWN_ACTOR"
  | "INVALID_INPUT"
  | "NON_CANONICAL_INPUT"
  | "REJECTED_INPUT"
  | "RNG_MISMATCH"
  | "OUTCOME_MISMATCH"
  | "INVALID_RNG_STATE"
  | "PROJECTION_FAILED"
  | "REPLAY_INCOMPLETE"
  | "VIEWER_NOT_PLAYER"
  | "FRAME_LIMIT_EXCEEDED"
  | "RESPONSE_SIZE_EXCEEDED";

export interface RealtimeReplayFailure {
  readonly ok: false;
  readonly code: RealtimeReplayFailureCode;
  readonly message: string;
  readonly sequence?: number;
}

export interface RealtimeReplaySuccess<State extends JsonValue = JsonValue> {
  readonly ok: true;
  readonly result: RealtimeReplayResult<State>;
}

export type RealtimeReplayVerification<State extends JsonValue = JsonValue> =
  RealtimeReplaySuccess<State> | RealtimeReplayFailure;

export type RealtimeDefinitionResolver = (
  gameId: string,
  gameVersion: string,
) => UnknownRealtimeGameDefinition | undefined;

function fail(
  code: RealtimeReplayFailureCode,
  message: string,
  sequence?: number,
): RealtimeReplayFailure {
  return sequence === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, sequence };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasExactlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isJsonValueInternal(
  value: unknown,
  ancestors: WeakSet<object>,
): value is JsonValue {
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

function isJsonValue(value: unknown): value is JsonValue {
  return isJsonValueInternal(value, new WeakSet<object>());
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => sameJson(entry, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && sameJson(leftRecord[key], rightRecord[key]),
    )
  );
}

function validGameId(value: string): boolean {
  try {
    defineRealtimeGameId(value);
    return true;
  } catch {
    return false;
  }
}

function validGameVersion(value: string): boolean {
  try {
    defineRealtimeGameVersion(value);
    return true;
  } catch {
    return false;
  }
}

function validRng(
  rng: unknown,
  seed: string,
  minimumCursor: number,
): rng is RealtimeRngState {
  return (
    isRecord(rng) &&
    hasExactlyKeys(rng, ["algorithm", "seed", "cursor"]) &&
    rng.algorithm === REALTIME_RNG_ALGORITHM_V1 &&
    rng.seed === seed &&
    Number.isSafeInteger(rng.cursor) &&
    (rng.cursor as number) >= minimumCursor
  );
}

const MAX_REALTIME_REPLAY_FRAME_COUNT = 3_601;
const MAX_REALTIME_REPLAY_FRAME_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface RealtimeReplayFrame {
  readonly tick: number;
  readonly view: JsonValue;
}

export type RealtimeReplayFrameReconstructionResult =
  | {
      readonly status: "rebuilt";
      readonly frames: readonly RealtimeReplayFrame[];
    }
  | {
      readonly status: "invalid";
      readonly code: RealtimeReplayFailureCode;
      readonly sequence?: number;
    };

export interface RealtimeReplayViewer {
  readonly kind: "player";
  readonly slotId: string;
}

const FORBIDDEN_PROJECTED_KEYS = new Set([
  "replayId",
  "seed",
  "rng",
  "rngState",
  "state",
  "rawState",
  "authoritativeState",
  "input",
  "inputs",
  "actorSlotId",
  "playerSessionId",
  "userId",
  "sessionId",
  "canonicalInputLog",
  "canonicalReplay",
  "events",
  "replay",
]);

function containsForbiddenProjectedKey(value: JsonValue): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenProjectedKey(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, child]) =>
        FORBIDDEN_PROJECTED_KEYS.has(key) ||
        containsForbiddenProjectedKey(child),
    );
  }
  return false;
}

function framesExceedResponseLimit(
  frames: readonly RealtimeReplayFrame[],
): boolean {
  try {
    const serialized = JSON.stringify(frames);
    let bytes = 0;
    for (let index = 0; index < serialized.length; index += 1) {
      const codeUnit = serialized.charCodeAt(index);
      if (codeUnit <= 0x7f) bytes += 1;
      else if (codeUnit <= 0x7ff) bytes += 2;
      else if (
        codeUnit >= 0xd800 &&
        codeUnit <= 0xdbff &&
        index + 1 < serialized.length &&
        serialized.charCodeAt(index + 1) >= 0xdc00 &&
        serialized.charCodeAt(index + 1) <= 0xdfff
      ) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
      if (bytes > MAX_REALTIME_REPLAY_FRAME_RESPONSE_BYTES) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** Clone projected data before exposing it and freeze the complete tree. */
function cloneAndFreezeJson(value: JsonValue): JsonValue {
  const clone = JSON.parse(JSON.stringify(value)) as JsonValue;
  const seen = new WeakSet<object>();
  const freeze = (candidate: JsonValue): JsonValue => {
    if (candidate === null || typeof candidate !== "object") return candidate;
    if (seen.has(candidate)) return candidate;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (const child of candidate) freeze(child);
    } else {
      for (const child of Object.values(candidate)) freeze(child);
    }
    return Object.freeze(candidate);
  };
  return freeze(clone);
}

export function verifyRealtimeReplay(
  replay: unknown,
  resolver: RealtimeDefinitionResolver,
): RealtimeReplayVerification {
  if (
    !isRecord(replay) ||
    !hasExactlyKeys(replay, [
      "header",
      "events",
      "recordedRngCursor",
      "recordedOutcome",
      "finalTick",
    ])
  ) {
    return fail("INVALID_HEADER", "Replay envelope is invalid.");
  }
  const headerValue = replay.header;
  if (
    !isRecord(headerValue) ||
    !hasExactlyKeys(headerValue, [
      "replayFormatVersion",
      "runtime",
      "gameId",
      "gameVersion",
      "tickRate",
      "rng",
      "initialConfig",
      "players",
    ])
  ) {
    return fail("INVALID_HEADER", "Realtime replay header is invalid.");
  }
  const header = headerValue;
  if (
    header.replayFormatVersion !== 1 ||
    header.runtime !== "realtime" ||
    header.tickRate !== 60 ||
    typeof header.gameId !== "string" ||
    typeof header.gameVersion !== "string" ||
    !validGameId(header.gameId) ||
    !validGameVersion(header.gameVersion) ||
    !isRecord(header.rng) ||
    !hasExactlyKeys(header.rng, ["algorithm", "seed"]) ||
    header.rng.algorithm !== REALTIME_RNG_ALGORITHM_V1 ||
    typeof header.rng.seed !== "string" ||
    header.rng.seed.length === 0 ||
    header.rng.seed.length > 4096 ||
    !Array.isArray(header.players) ||
    header.players.length !== 2 ||
    !Array.isArray(replay.events) ||
    !Number.isSafeInteger(replay.finalTick) ||
    (replay.finalTick as number) < 0 ||
    !(
      replay.recordedRngCursor === null ||
      (Number.isSafeInteger(replay.recordedRngCursor) &&
        (replay.recordedRngCursor as number) >= 0)
    ) ||
    !isJsonValue(replay.recordedOutcome)
  ) {
    return fail("INVALID_HEADER", "Realtime replay header fields are invalid.");
  }
  const hasRecordedRng = replay.recordedRngCursor !== null;
  const hasRecordedOutcome = replay.recordedOutcome !== null;
  if (hasRecordedRng !== hasRecordedOutcome) {
    return fail(
      "INVALID_HEADER",
      "Realtime replay completion fields must be present together.",
    );
  }
  if (hasRecordedRng && (replay.finalTick as number) <= 0) {
    return fail(
      "INVALID_HEADER",
      "A completed realtime replay must contain at least one tick.",
    );
  }
  const players: string[] = [];
  for (const player of header.players) {
    if (
      !isRecord(player) ||
      !hasExactlyKeys(player, ["slotId"]) ||
      typeof player.slotId !== "string" ||
      player.slotId.length === 0 ||
      player.slotId.length > 128
    ) {
      return fail("INVALID_HEADER", "Realtime replay player is invalid.");
    }
    players.push(player.slotId);
  }
  if (new Set(players).size !== players.length) {
    return fail("INVALID_HEADER", "Realtime replay players must be distinct.");
  }
  let definition: UnknownRealtimeGameDefinition | undefined;
  try {
    definition = resolver(header.gameId, header.gameVersion);
  } catch {
    definition = undefined;
  }
  if (
    definition === undefined ||
    definition.manifest.runtime !== "realtime" ||
    definition.manifest.id !== header.gameId ||
    definition.manifest.gameVersion !== header.gameVersion ||
    definition.manifest.tickRate !== 60 ||
    definition.manifest.minPlayers !== 2 ||
    definition.manifest.maxPlayers !== 2
  ) {
    return fail(
      "UNKNOWN_GAME_VERSION",
      "No exact realtime definition is registered.",
    );
  }
  const configResult = definition.configSchema.safeParse(header.initialConfig);
  if (
    !configResult.success ||
    !isJsonValue(configResult.data) ||
    !sameJson(configResult.data, header.initialConfig)
  ) {
    return fail("INVALID_CONFIG", "Replay config is invalid or non-canonical.");
  }
  let state: JsonValue;
  let rng: RealtimeRngState;
  try {
    const initial = definition.createInitialState({
      config: configResult.data,
      players: players.map((slot) => defineRealtimePlayerSlotId(slot)),
      rng: createRealtimeRng(header.rng.seed),
    });
    if (
      !isJsonValue(initial.state) ||
      !validRng(initial.rng, header.rng.seed, 0)
    ) {
      return fail(
        "INVALID_RNG_STATE",
        "Initial realtime RNG/state is invalid.",
      );
    }
    state = initial.state;
    rng = initial.rng;
  } catch {
    return fail("INVALID_CONFIG", "Replay initial state could not be created.");
  }
  const parsedEvents: Array<{
    readonly sequence: number;
    readonly tick: number;
    readonly slotId: RealtimePlayerSlotId;
    readonly input: JsonValue;
  }> = [];
  let lastTick = -1;
  for (const [index, rawEvent] of replay.events.entries()) {
    const sequence = index + 1;
    if (
      !isRecord(rawEvent) ||
      !hasExactlyKeys(rawEvent, ["sequence", "tick", "actorSlotId", "input"])
    ) {
      return fail(
        "INVALID_EVENT",
        "Replay event envelope is invalid.",
        sequence,
      );
    }
    if (rawEvent.sequence !== sequence) {
      return fail(
        "SEQUENCE_GAP",
        "Replay event sequence is not contiguous.",
        sequence,
      );
    }
    if (
      !Number.isSafeInteger(rawEvent.tick) ||
      (rawEvent.tick as number) < 0 ||
      (rawEvent.tick as number) >= (replay.finalTick as number)
    ) {
      return fail(
        "INVALID_EVENT",
        "Replay event tick is outside the simulated range.",
        sequence,
      );
    }
    if ((rawEvent.tick as number) < lastTick) {
      return fail("TICK_ORDER", "Replay event tick moved backwards.", sequence);
    }
    lastTick = rawEvent.tick as number;
    if (
      typeof rawEvent.actorSlotId !== "string" ||
      !players.includes(rawEvent.actorSlotId)
    ) {
      return fail(
        "UNKNOWN_ACTOR",
        "Replay event actor is not a player slot.",
        sequence,
      );
    }
    const parsedInput = definition.inputSchema.safeParse(rawEvent.input);
    if (!parsedInput.success || !isJsonValue(parsedInput.data)) {
      return fail("INVALID_INPUT", "Replay input is invalid.", sequence);
    }
    if (!sameJson(parsedInput.data, rawEvent.input)) {
      return fail(
        "NON_CANONICAL_INPUT",
        "Replay input is not canonical.",
        sequence,
      );
    }
    parsedEvents.push({
      sequence,
      tick: rawEvent.tick as number,
      slotId: defineRealtimePlayerSlotId(rawEvent.actorSlotId),
      input: parsedInput.data,
    });
  }
  let eventIndex = 0;
  for (let tick = 0; tick < (replay.finalTick as number); tick += 1) {
    const changes = new Map<RealtimePlayerSlotId, JsonValue>();
    while (parsedEvents[eventIndex]?.tick === tick) {
      const event = parsedEvents[eventIndex];
      if (event === undefined) break;
      changes.set(event.slotId, event.input);
      eventIndex += 1;
    }
    const inputs = players.flatMap((slot) => {
      const slotId = defineRealtimePlayerSlotId(slot);
      const input = changes.get(slotId);
      return input === undefined ? [] : [{ slotId, input }];
    });
    try {
      const next = definition.step({ state, tick, inputs, rng });
      if (
        !isJsonValue(next.state) ||
        !validRng(next.rng, rng.seed, rng.cursor)
      ) {
        return fail(
          "INVALID_RNG_STATE",
          "Realtime step returned invalid state/RNG.",
        );
      }
      state = next.state;
      rng = next.rng;
    } catch {
      return fail(
        "REJECTED_INPUT",
        "Replay simulation rejected an input frame.",
      );
    }
  }
  if (eventIndex !== parsedEvents.length) {
    return fail("INVALID_EVENT", "Replay contains an unconsumed event.");
  }
  let outcome: JsonValue | null;
  try {
    outcome = definition.getOutcome(state);
  } catch {
    return fail("REJECTED_INPUT", "Replay outcome could not be evaluated.");
  }
  if (!isJsonValue(outcome)) {
    return fail("OUTCOME_MISMATCH", "Replay outcome is not JSON-serializable.");
  }
  if (
    replay.recordedRngCursor !== null &&
    rng.cursor !== replay.recordedRngCursor
  ) {
    return fail("RNG_MISMATCH", "Replay RNG cursor does not match.");
  }
  if (
    replay.recordedOutcome !== null &&
    !sameJson(outcome, replay.recordedOutcome)
  ) {
    return fail("OUTCOME_MISMATCH", "Replay outcome does not match.");
  }
  return {
    ok: true,
    result: {
      state: state as JsonValue,
      rng,
      outcome,
      finalTick: replay.finalTick as number,
    },
  };
}

/** Rebuilds a completed replay into bounded, player-scoped projected frames. */
export function reconstructRealtimeReplayFrames(
  replayInput: unknown,
  resolver: RealtimeDefinitionResolver,
  viewer: RealtimeReplayViewer,
): RealtimeReplayFrameReconstructionResult {
  const verification = verifyRealtimeReplay(replayInput, resolver);
  if (!verification.ok) {
    return {
      status: "invalid",
      code: verification.code,
      ...(verification.sequence === undefined
        ? {}
        : { sequence: verification.sequence }),
    };
  }
  if (
    !isRecord(replayInput) ||
    !isRecord(replayInput.header) ||
    replayInput.recordedRngCursor === null ||
    replayInput.recordedOutcome === null
  ) {
    return { status: "invalid", code: "REPLAY_INCOMPLETE" };
  }
  const header = replayInput.header;
  let definition: UnknownRealtimeGameDefinition | undefined;
  try {
    definition = resolver(
      header.gameId as string,
      header.gameVersion as string,
    );
  } catch {
    definition = undefined;
  }
  if (definition === undefined) {
    return { status: "invalid", code: "UNKNOWN_GAME_VERSION" };
  }
  const players = (header.players as Array<{ readonly slotId: string }>).map(
    (player) => player.slotId,
  );
  if (viewer.kind !== "player" || !players.includes(viewer.slotId)) {
    return { status: "invalid", code: "VIEWER_NOT_PLAYER" };
  }
  const finalTick = replayInput.finalTick as number;
  if (finalTick + 1 > MAX_REALTIME_REPLAY_FRAME_COUNT) {
    return { status: "invalid", code: "FRAME_LIMIT_EXCEEDED" };
  }
  const configResult = definition.configSchema.safeParse(header.initialConfig);
  if (!configResult.success)
    return { status: "invalid", code: "INVALID_CONFIG" };
  let state: JsonValue;
  let rng: RealtimeRngState;
  try {
    const initialized = definition.createInitialState({
      config: configResult.data,
      players: players.map((slot) => defineRealtimePlayerSlotId(slot)),
      rng: createRealtimeRng((header.rng as { readonly seed: string }).seed),
    });
    if (
      !isJsonValue(initialized.state) ||
      !validRng(
        initialized.rng,
        (header.rng as { readonly seed: string }).seed,
        0,
      )
    ) {
      return { status: "invalid", code: "INVALID_RNG_STATE" };
    }
    state = initialized.state;
    rng = initialized.rng;
  } catch {
    return { status: "invalid", code: "INVALID_CONFIG" };
  }
  const frames: RealtimeReplayFrame[] = [];
  const append = (
    tick: number,
  ): RealtimeReplayFrameReconstructionResult | null => {
    let view: JsonValue;
    try {
      view = definition.projectView({
        state,
        viewer: {
          kind: "player",
          slotId: defineRealtimePlayerSlotId(viewer.slotId),
        },
      });
    } catch {
      return { status: "invalid", code: "PROJECTION_FAILED" };
    }
    if (!isJsonValue(view) || containsForbiddenProjectedKey(view)) {
      return { status: "invalid", code: "PROJECTION_FAILED" };
    }
    frames.push({ tick, view: cloneAndFreezeJson(view) });
    return framesExceedResponseLimit(frames)
      ? { status: "invalid", code: "RESPONSE_SIZE_EXCEEDED" }
      : null;
  };
  const initialFrame = append(0);
  if (initialFrame !== null) return initialFrame;
  const events = replayInput.events as Array<RealtimeReplayEvent>;
  let eventIndex = 0;
  for (let tick = 0; tick < finalTick; tick += 1) {
    const changes = new Map<RealtimePlayerSlotId, JsonValue>();
    while (events[eventIndex]?.tick === tick) {
      const event = events[eventIndex];
      if (event === undefined) break;
      changes.set(defineRealtimePlayerSlotId(event.actorSlotId), event.input);
      eventIndex += 1;
    }
    const inputs = players.flatMap((slot) => {
      const slotId = defineRealtimePlayerSlotId(slot);
      const input = changes.get(slotId);
      return input === undefined ? [] : [{ slotId, input }];
    });
    try {
      const next = definition.step({ state, tick, inputs, rng });
      if (
        !isJsonValue(next.state) ||
        !validRng(next.rng, rng.seed, rng.cursor)
      ) {
        return { status: "invalid", code: "INVALID_RNG_STATE" };
      }
      state = next.state;
      rng = next.rng;
    } catch {
      return { status: "invalid", code: "REJECTED_INPUT" };
    }
    const frame = append(tick + 1);
    if (frame !== null) return frame;
  }
  return { status: "rebuilt", frames };
}
