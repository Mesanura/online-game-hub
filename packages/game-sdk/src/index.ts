import type { ZodType } from "zod";

declare const gameIdBrand: unique symbol;
declare const gameVersionBrand: unique symbol;
declare const playerSlotIdBrand: unique symbol;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type DeepReadonly<T> = T extends JsonPrimitive
  ? T
  : T extends readonly unknown[]
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type GameId = string & { readonly [gameIdBrand]: "GameId" };
export type GameVersion = string & {
  readonly [gameVersionBrand]: "GameVersion";
};
export type PlayerSlotId = string & {
  readonly [playerSlotIdBrand]: "PlayerSlotId";
};
export type GameRuleErrorCode = string;
export type ReplayMode = "none" | "record-only" | "player-playback";

const GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const EXACT_SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export function isGameId(value: string): value is GameId {
  return GAME_ID_PATTERN.test(value);
}

export function defineGameId(value: string): GameId {
  if (!isGameId(value)) {
    throw new TypeError("Invalid game id: " + JSON.stringify(value) + ".");
  }

  return value;
}

export function isGameVersion(value: string): value is GameVersion {
  return EXACT_SEMVER_PATTERN.test(value);
}

export function defineGameVersion(value: string): GameVersion {
  if (!isGameVersion(value)) {
    throw new TypeError(
      "Invalid exact game version: " + JSON.stringify(value) + ".",
    );
  }

  return value;
}

export function isPlayerSlotId(value: string): value is PlayerSlotId {
  return value.length > 0;
}

export function definePlayerSlotId(value: string): PlayerSlotId {
  if (!isPlayerSlotId(value)) {
    throw new TypeError("Player slot id must not be empty.");
  }

  return value;
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

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "object") {
    return false;
  }

  if (ancestors.has(value)) {
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

export function isJsonValue(value: unknown): value is JsonValue {
  return isJsonValueInternal(value, new WeakSet<object>());
}

export type Viewer =
  | { readonly kind: "player"; readonly slotId: PlayerSlotId }
  | { readonly kind: "spectator" };

export interface GameManifest {
  readonly id: GameId;
  readonly gameVersion: GameVersion;
  readonly title: string;
  readonly description: string;
  readonly defaultConfig: JsonValue;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly runtime: "turn-based";
  readonly capabilities: {
    readonly hiddenInformation: boolean;
    readonly deterministicRandomness: boolean;
    /** Explicit recording/playback support for this exact game version. */
    readonly replay: ReplayMode;
    readonly playerAssignment?: {
      readonly kind: "camp" | "seat";
      readonly options: readonly string[];
    };
  };
}

export const RNG_ALGORITHM_V1 = "fnv1a32-counter-v1" as const;
export type RngAlgorithm = typeof RNG_ALGORITHM_V1;

export interface RngState {
  readonly algorithm: RngAlgorithm;
  readonly seed: string;
  readonly cursor: number;
}

export interface RandomStep<T extends JsonValue> {
  readonly value: T;
  readonly next: RngState;
}

export function createRng(seed: string): RngState {
  if (seed.length === 0) {
    throw new TypeError("RNG seed must not be empty.");
  }

  return { algorithm: RNG_ALGORITHM_V1, seed, cursor: 0 };
}

function validateRng(rng: Readonly<RngState>): void {
  if (rng.algorithm !== RNG_ALGORITHM_V1) {
    throw new TypeError(
      "Unsupported RNG algorithm: " + String(rng.algorithm) + ".",
    );
  }

  if (rng.seed.length === 0) {
    throw new TypeError("RNG seed must not be empty.");
  }

  if (!Number.isSafeInteger(rng.cursor) || rng.cursor < 0) {
    throw new RangeError("RNG cursor must be a non-negative safe integer.");
  }
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

export function nextInt(
  rng: Readonly<RngState>,
  maxExclusive: number,
): RandomStep<number> {
  validateRng(rng);
  if (
    !Number.isSafeInteger(maxExclusive) ||
    maxExclusive <= 0 ||
    maxExclusive > 0x1_00_00_00_00
  ) {
    throw new RangeError("maxExclusive must be an integer between 1 and 2^32.");
  }

  const uint32Range = 0x1_00_00_00_00;
  const unbiasedLimit = uint32Range - (uint32Range % maxExclusive);
  let cursor = rng.cursor;

  for (;;) {
    if (cursor >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError("RNG cursor is exhausted.");
    }

    const candidate = counterHash(rng.seed, cursor);
    cursor += 1;
    if (candidate < unbiasedLimit) {
      return {
        value: candidate % maxExclusive,
        next: { algorithm: RNG_ALGORITHM_V1, seed: rng.seed, cursor },
      };
    }
  }
}

export interface InitialContext<Config extends JsonValue> {
  readonly config: DeepReadonly<Config>;
  readonly players: readonly PlayerSlotId[];
  /** Optional per-player metadata aligned with `players`, such as a camp. */
  readonly playerAssignments?: readonly string[];
  readonly rng: Readonly<RngState>;
}

export interface Initialized<State extends JsonValue> {
  readonly state: State;
  readonly rng: RngState;
}

export interface TransitionContext<
  State extends JsonValue,
  Action extends JsonValue,
> {
  readonly state: DeepReadonly<State>;
  readonly actorSlotId: PlayerSlotId;
  readonly action: DeepReadonly<Action>;
  readonly rng: Readonly<RngState>;
}

export type Transition<State extends JsonValue> =
  | {
      readonly status: "accepted";
      readonly state: State;
      readonly rng: RngState;
    }
  | { readonly status: "rejected"; readonly code: GameRuleErrorCode };

export interface ViewContext<State extends JsonValue> {
  readonly state: DeepReadonly<State>;
  readonly viewer: Viewer;
}

export interface GameDefinition<
  Config extends JsonValue,
  State extends JsonValue,
  Action extends JsonValue,
  View extends JsonValue,
  Outcome extends JsonValue,
> {
  readonly manifest: GameManifest;
  readonly configSchema: ZodType<Config>;
  readonly actionSchema: ZodType<Action>;
  createInitialState(context: InitialContext<Config>): Initialized<State>;
  transition(context: TransitionContext<State, Action>): Transition<State>;
  projectView(context: ViewContext<State>): View;
  getOutcome(state: DeepReadonly<State>): Outcome | null;
}

export interface UnknownGameDefinition {
  readonly manifest: GameManifest;
  readonly configSchema: ZodType<JsonValue>;
  readonly actionSchema: ZodType<JsonValue>;
  createInitialState(context: {
    readonly config: JsonValue;
    readonly players: readonly PlayerSlotId[];
    readonly playerAssignments?: readonly string[];
    readonly rng: Readonly<RngState>;
  }): Initialized<JsonValue>;
  transition(context: {
    readonly state: JsonValue;
    readonly actorSlotId: PlayerSlotId;
    readonly action: JsonValue;
    readonly rng: Readonly<RngState>;
  }): Transition<JsonValue>;
  projectView(context: {
    readonly state: JsonValue;
    readonly viewer: Viewer;
  }): JsonValue;
  getOutcome(state: JsonValue): JsonValue | null;
}

export function eraseGameDefinition<
  Config extends JsonValue,
  State extends JsonValue,
  Action extends JsonValue,
  View extends JsonValue,
  Outcome extends JsonValue,
>(
  definition: GameDefinition<Config, State, Action, View, Outcome>,
): UnknownGameDefinition {
  return definition as unknown as UnknownGameDefinition;
}
