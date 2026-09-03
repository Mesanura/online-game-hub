import type { ZodType } from "zod";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

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

export function defineRealtimeGameId(value: string): RealtimeGameId {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new TypeError("Invalid realtime game id.");
  }
  return value as RealtimeGameId;
}

export function defineRealtimeGameVersion(value: string): RealtimeGameVersion {
  if (
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(
      value,
    )
  ) {
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
  | "REJECTED_INPUT"
  | "RNG_MISMATCH"
  | "OUTCOME_MISMATCH";

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

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function verifyRealtimeReplay(
  replay: unknown,
  resolver: RealtimeDefinitionResolver,
): RealtimeReplayVerification {
  if (replay === null || typeof replay !== "object") {
    return fail("INVALID_HEADER", "Replay must be an object.");
  }
  const candidate = replay as Partial<RealtimeCanonicalReplay>;
  const header = candidate.header;
  if (
    header === null ||
    typeof header !== "object" ||
    header.replayFormatVersion !== 1 ||
    header.runtime !== "realtime" ||
    header.tickRate !== 60 ||
    typeof header.gameId !== "string" ||
    typeof header.gameVersion !== "string" ||
    !Array.isArray(header.players) ||
    header.players.length !== 2 ||
    !Array.isArray(candidate.events) ||
    typeof candidate.finalTick !== "number" ||
    !Number.isSafeInteger(candidate.finalTick) ||
    candidate.finalTick < 0
  ) {
    return fail("INVALID_HEADER", "Realtime replay header is invalid.");
  }
  const definition = resolver(header.gameId, header.gameVersion);
  if (definition === undefined || definition.manifest.runtime !== "realtime") {
    return fail(
      "UNKNOWN_GAME_VERSION",
      "No exact realtime definition is registered.",
    );
  }
  const players = header.players.map((player) => player.slotId);
  if (
    players.some((slot) => typeof slot !== "string" || slot.length === 0) ||
    new Set(players).size !== players.length ||
    header.rng === null ||
    typeof header.rng !== "object" ||
    header.rng.algorithm !== REALTIME_RNG_ALGORITHM_V1 ||
    typeof header.rng.seed !== "string" ||
    !Number.isSafeInteger(header.rng.seed.length) ||
    !Number.isSafeInteger(candidate.recordedRngCursor ?? 0)
  ) {
    return fail("INVALID_HEADER", "Realtime replay header fields are invalid.");
  }
  const configResult = definition.configSchema.safeParse(header.initialConfig);
  if (!configResult.success)
    return fail("INVALID_CONFIG", "Replay config is invalid.");
  let state: JsonValue;
  let rng: RealtimeRngState;
  try {
    const initial = definition.createInitialState({
      config: configResult.data,
      players: players as RealtimePlayerSlotId[],
      rng: createRealtimeRng(header.rng.seed),
    });
    state = initial.state;
    rng = initial.rng;
  } catch {
    return fail("INVALID_CONFIG", "Replay initial state could not be created.");
  }
  let lastTick = -1;
  const parsedEvents: Array<{
    readonly tick: number;
    readonly slotId: RealtimePlayerSlotId;
    readonly input: JsonValue;
  }> = [];
  for (const [index, rawEvent] of candidate.events.entries()) {
    const event = rawEvent as Partial<RealtimeReplayEvent>;
    const sequence = index + 1;
    if (event.sequence !== sequence)
      return fail(
        "SEQUENCE_GAP",
        "Replay event sequence is not contiguous.",
        sequence,
      );
    if (!Number.isSafeInteger(event.tick) || (event.tick as number) < 0)
      return fail("INVALID_EVENT", "Replay event tick is invalid.", sequence);
    if ((event.tick as number) < lastTick)
      return fail("TICK_ORDER", "Replay event tick moved backwards.", sequence);
    lastTick = event.tick as number;
    if (
      typeof event.actorSlotId !== "string" ||
      !players.includes(event.actorSlotId)
    )
      return fail(
        "UNKNOWN_ACTOR",
        "Replay event actor is not a player slot.",
        sequence,
      );
    if ((event.tick as number) >= (candidate.finalTick as number)) {
      return fail(
        "INVALID_EVENT",
        "Replay event tick is outside the simulated range.",
        sequence,
      );
    }
    const parsedInput = definition.inputSchema.safeParse(event.input);
    if (!parsedInput.success)
      return fail("INVALID_INPUT", "Replay input is invalid.", sequence);
    parsedEvents.push({
      tick: event.tick as number,
      slotId: event.actorSlotId as RealtimePlayerSlotId,
      input: parsedInput.data,
    });
  }
  let eventIndex = 0;
  for (let tick = 0; tick < (candidate.finalTick as number); tick += 1) {
    const changes = new Map<RealtimePlayerSlotId, JsonValue>();
    while (parsedEvents[eventIndex]?.tick === tick) {
      const event = parsedEvents[eventIndex];
      if (event !== undefined) changes.set(event.slotId, event.input);
      eventIndex += 1;
    }
    const inputs = players.flatMap((slotId) => {
      const brandedSlotId = slotId as RealtimePlayerSlotId;
      const input = changes.get(brandedSlotId);
      return input === undefined ? [] : [{ slotId: brandedSlotId, input }];
    });
    try {
      const result = definition.step({ state, tick, inputs, rng });
      state = result.state;
      rng = result.rng;
    } catch {
      return fail(
        "REJECTED_INPUT",
        "Replay simulation rejected an input frame.",
      );
    }
  }
  const outcome = definition.getOutcome(state);
  if (
    candidate.recordedRngCursor !== null &&
    candidate.recordedRngCursor !== undefined &&
    rng.cursor !== candidate.recordedRngCursor
  ) {
    return fail("RNG_MISMATCH", "Replay RNG cursor does not match.");
  }
  if (
    candidate.recordedOutcome !== null &&
    candidate.recordedOutcome !== undefined &&
    !sameJson(outcome, candidate.recordedOutcome)
  ) {
    return fail("OUTCOME_MISMATCH", "Replay outcome does not match.");
  }
  return {
    ok: true,
    result: { state, rng, outcome, finalTick: candidate.finalTick as number },
  };
}
