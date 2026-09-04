import { randomBytes, randomUUID } from "node:crypto";

import { CloseCode, Room, ServerError } from "@colyseus/core";
import type { Client } from "@colyseus/core";
import {
  PROTOCOL_VERSION,
  REALTIME_GAME_ROOM_NAME,
  REALTIME_INPUT_MESSAGE,
  REALTIME_PROTOCOL_VERSION,
  REALTIME_SERVER_MESSAGE,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  createGameRoomRequestSchema,
  gameRoomRequestSchema,
  realtimeInputCommandSchema,
  roomControlCommandSchema,
} from "@online-game-hub/protocol";
import type {
  CommandRejected,
  ProtocolErrorCode,
  RealtimeErrorCode,
  RealtimeInputCommand,
  RealtimeRejected,
  RealtimeSnapshot,
  RoomCloseReason,
  RoomConnected,
  RoomLifecycleState,
} from "@online-game-hub/protocol";
import {
  REALTIME_RNG_ALGORITHM_V1,
  createRealtimeRng,
  defineRealtimePlayerSlotId,
  isRealtimeGameId,
  isRealtimeGameVersion,
} from "@online-game-hub/realtime-game-sdk";
import type {
  JsonValue,
  RealtimeCanonicalReplay,
  RealtimeGameDefinition,
  RealtimePlayerInput,
  RealtimePlayerSlotId,
  RealtimeReplayEvent,
  RealtimeReplayHeader,
  RealtimeRngState,
  UnknownRealtimeGameDefinition,
} from "@online-game-hub/realtime-game-sdk";

export interface RealtimeReplayStore {
  create(replayId: string, header: RealtimeReplayHeader): Promise<void>;
  append(
    replayId: string,
    expectedSequence: number,
    event: RealtimeReplayEvent,
  ): Promise<void>;
  complete(
    replayId: string,
    expectedSequence: number,
    finalTick: number,
    finalRngCursor: number,
    outcome: JsonValue,
  ): Promise<void>;
  get(replayId: string): Promise<RealtimeCanonicalReplay | null>;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isJsonValue(
  value: unknown,
  ancestors = new WeakSet<object>(),
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
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
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

function validRealtimeReplayHeader(
  value: unknown,
): value is RealtimeReplayHeader {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      "replayFormatVersion",
      "runtime",
      "gameId",
      "gameVersion",
      "tickRate",
      "rng",
      "initialConfig",
      "players",
    ]) ||
    !isRecord(value.rng) ||
    !hasExactlyKeys(value.rng, ["algorithm", "seed"]) ||
    !Array.isArray(value.players)
  ) {
    return false;
  }
  const players = value.players;
  return (
    value.replayFormatVersion === 1 &&
    value.runtime === "realtime" &&
    typeof value.gameId === "string" &&
    isRealtimeGameId(value.gameId) &&
    typeof value.gameVersion === "string" &&
    isRealtimeGameVersion(value.gameVersion) &&
    value.tickRate === 60 &&
    value.rng.algorithm === REALTIME_RNG_ALGORITHM_V1 &&
    typeof value.rng.seed === "string" &&
    value.rng.seed.length > 0 &&
    value.rng.seed.length <= 4096 &&
    isJsonValue(value.initialConfig) &&
    players.length === 2 &&
    players.every(
      (player) =>
        isRecord(player) &&
        hasExactlyKeys(player, ["slotId"]) &&
        typeof player.slotId === "string" &&
        player.slotId.length > 0 &&
        player.slotId.length <= 128,
    ) &&
    new Set(players.map((player) => (player as { slotId: string }).slotId))
      .size === 2
  );
}

function validRealtimeReplayEvent(
  value: unknown,
): value is RealtimeReplayEvent {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ["sequence", "tick", "actorSlotId", "input"])
  ) {
    return false;
  }
  return (
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) > 0 &&
    Number.isSafeInteger(value.tick) &&
    (value.tick as number) >= 0 &&
    typeof value.actorSlotId === "string" &&
    value.actorSlotId.length > 0 &&
    value.actorSlotId.length <= 128 &&
    isJsonValue(value.input)
  );
}

export class InMemoryRealtimeReplayStore implements RealtimeReplayStore {
  readonly #records = new Map<string, RealtimeCanonicalReplay>();

  public async create(
    replayId: string,
    header: RealtimeReplayHeader,
  ): Promise<void> {
    if (
      replayId.length === 0 ||
      replayId.length > 128 ||
      !validRealtimeReplayHeader(header)
    ) {
      throw new TypeError("Invalid realtime replay header.");
    }
    const current = this.#records.get(replayId);
    if (current !== undefined) {
      if (!sameJson(current.header, header))
        throw new Error("Replay header conflict.");
      return;
    }
    this.#records.set(replayId, {
      header: cloneJson(header),
      events: [],
      recordedRngCursor: null,
      recordedOutcome: null,
      finalTick: 0,
    });
  }

  public async append(
    replayId: string,
    expectedSequence: number,
    event: RealtimeReplayEvent,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(expectedSequence) ||
      expectedSequence < 0 ||
      !validRealtimeReplayEvent(event)
    ) {
      if (
        isRecord(event) &&
        Number.isSafeInteger(event.tick) &&
        (event.tick as number) < 0
      ) {
        throw new TypeError(
          "Invalid realtime replay event: tick moved backwards.",
        );
      }
      throw new TypeError("Invalid realtime replay event.");
    }
    const current = this.#records.get(replayId);
    if (current === undefined) throw new Error("Replay does not exist.");
    const existing = current.events[event.sequence - 1];
    if (existing !== undefined) {
      if (
        expectedSequence !== event.sequence - 1 ||
        !sameJson(existing, event)
      ) {
        throw new Error("Replay event conflict.");
      }
      return;
    }
    if (current.recordedOutcome !== null)
      throw new Error("Replay is complete.");
    if (
      current.events.length !== expectedSequence ||
      event.sequence !== expectedSequence + 1
    ) {
      throw new Error("Replay sequence is not contiguous.");
    }
    const previous = current.events.at(-1);
    if (previous !== undefined && event.tick < previous.tick) {
      throw new Error("Replay tick moved backwards.");
    }
    if (
      !current.header.players.some(
        (player) => player.slotId === event.actorSlotId,
      )
    ) {
      throw new Error("Replay event actor is not a player.");
    }
    this.#records.set(replayId, {
      ...current,
      events: [...current.events, cloneJson(event)],
    });
  }

  public async complete(
    replayId: string,
    expectedSequence: number,
    finalTick: number,
    finalRngCursor: number,
    outcome: JsonValue,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(expectedSequence) ||
      expectedSequence < 0 ||
      !Number.isSafeInteger(finalTick) ||
      finalTick <= 0 ||
      !Number.isSafeInteger(finalRngCursor) ||
      finalRngCursor < 0 ||
      outcome === null ||
      !isJsonValue(outcome)
    ) {
      throw new TypeError("Invalid realtime replay completion.");
    }
    const current = this.#records.get(replayId);
    if (current === undefined) throw new Error("Replay does not exist.");
    if (current.events.length !== expectedSequence)
      throw new Error("Replay sequence conflict.");
    if (current.recordedOutcome !== null) {
      if (
        current.finalTick !== finalTick ||
        current.recordedRngCursor !== finalRngCursor ||
        !sameJson(current.recordedOutcome, outcome)
      ) {
        throw new Error("Replay completion conflict.");
      }
      return;
    }
    const lastEvent = current.events.at(-1);
    if (lastEvent !== undefined && lastEvent.tick >= finalTick) {
      throw new Error("Replay final tick does not follow its events.");
    }
    this.#records.set(replayId, {
      ...current,
      finalTick,
      recordedRngCursor: finalRngCursor,
      recordedOutcome: cloneJson(outcome),
    });
  }

  public async get(replayId: string): Promise<RealtimeCanonicalReplay | null> {
    const current = this.#records.get(replayId);
    return current === undefined ? null : cloneJson(current);
  }
}

export interface RealtimeRuntimeInputResult<View, Outcome> {
  readonly accepted: boolean;
  readonly effectiveTick?: number;
  readonly rejection?: RealtimeRejected;
  readonly snapshot?: RealtimeSnapshot<View, Outcome>;
}

export interface RealtimeRoundOptions<
  Config extends JsonValue,
  State extends JsonValue,
  Input extends JsonValue,
  View extends JsonValue,
  Outcome extends JsonValue,
> {
  readonly definition: RealtimeGameDefinition<
    Config,
    State,
    Input,
    View,
    Outcome
  >;
  readonly config: Config;
  readonly players: readonly [RealtimePlayerSlotId, RealtimePlayerSlotId];
  readonly rng: RealtimeRngState;
  readonly roundNumber: number;
  readonly replayId: string;
  readonly replayStore: RealtimeReplayStore;
}

interface QueuedInput<Input extends JsonValue> {
  readonly commandId: string;
  readonly slotId: RealtimePlayerSlotId;
  readonly inputSequence: number;
  readonly effectiveTick: number;
  readonly input: Input;
}

export class RealtimeRound<
  Config extends JsonValue,
  State extends JsonValue,
  Input extends JsonValue,
  View extends JsonValue,
  Outcome extends JsonValue,
> {
  readonly #definition: RealtimeGameDefinition<
    Config,
    State,
    Input,
    View,
    Outcome
  >;
  readonly #players: readonly [RealtimePlayerSlotId, RealtimePlayerSlotId];
  readonly #roundNumber: number;
  readonly #replayId: string;
  readonly #replayStore: RealtimeReplayStore;
  readonly #queued: QueuedInput<Input>[] = [];
  readonly #lastInputSequence = new Map<RealtimePlayerSlotId, number>();
  readonly #acknowledgedInputSequence = new Map<RealtimePlayerSlotId, number>();
  readonly #commands = new Map<
    string,
    {
      readonly slotId: RealtimePlayerSlotId;
      readonly result: RealtimeRuntimeInputResult<View, Outcome>;
    }
  >();
  #state: State;
  #rng: RealtimeRngState;
  #eventSequence = 0;
  #tick = 0;

  private constructor(
    options: RealtimeRoundOptions<Config, State, Input, View, Outcome>,
    state: State,
    rng: RealtimeRngState,
  ) {
    this.#definition = options.definition;
    this.#players = options.players;
    this.#roundNumber = options.roundNumber;
    this.#replayId = options.replayId;
    this.#replayStore = options.replayStore;
    this.#state = state;
    this.#rng = rng;
    for (const slotId of this.#players) {
      this.#lastInputSequence.set(slotId, 0);
      this.#acknowledgedInputSequence.set(slotId, 0);
    }
  }

  public static async create<
    Config extends JsonValue,
    State extends JsonValue,
    Input extends JsonValue,
    View extends JsonValue,
    Outcome extends JsonValue,
  >(
    options: RealtimeRoundOptions<Config, State, Input, View, Outcome>,
  ): Promise<RealtimeRound<Config, State, Input, View, Outcome>> {
    if (
      !Number.isSafeInteger(options.roundNumber) ||
      options.roundNumber <= 0
    ) {
      throw new RangeError("Round number must be a positive integer.");
    }
    const config = options.definition.configSchema.parse(options.config);
    const initialized = options.definition.createInitialState({
      config,
      players: options.players,
      rng: options.rng,
    });
    await options.replayStore.create(options.replayId, {
      replayFormatVersion: 1,
      runtime: "realtime",
      gameId: options.definition.manifest.id,
      gameVersion: options.definition.manifest.gameVersion,
      tickRate: 60,
      rng: { algorithm: options.rng.algorithm, seed: options.rng.seed },
      initialConfig: config,
      players: options.players.map((slotId) => ({ slotId })),
    });
    return new RealtimeRound(options, initialized.state, initialized.rng);
  }

  public get tick(): number {
    return this.#tick;
  }

  public get state(): Readonly<State> {
    return this.#state;
  }

  public async receiveInput(
    slotId: RealtimePlayerSlotId,
    payload: unknown,
  ): Promise<RealtimeRuntimeInputResult<View, Outcome>> {
    const envelope = realtimeInputCommandSchema.safeParse(payload);
    if (!envelope.success)
      return this.#reject(undefined, "INVALID_INPUT_PAYLOAD", slotId);
    const command = envelope.data;
    const cached = this.#commands.get(command.commandId);
    if (cached !== undefined) {
      return cached.slotId === slotId
        ? cached.result
        : this.#reject(command.commandId, "DUPLICATE_COMMAND", slotId);
    }
    if (!this.#players.includes(slotId))
      return this.#cacheReject(command, "NOT_A_PLAYER", slotId);
    if (this.#definition.getOutcome(this.#state) !== null)
      return this.#cacheReject(command, "MATCH_NOT_ACTIVE", slotId);
    if (command.roundNumber !== this.#roundNumber)
      return this.#cacheReject(command, "ROUND_MISMATCH", slotId);
    const lastSequence = this.#lastInputSequence.get(slotId) ?? 0;
    if (command.inputSequence <= lastSequence)
      return this.#cacheReject(command, "STALE_INPUT_SEQUENCE", slotId);
    const input = this.#definition.inputSchema.safeParse(command.input);
    if (!input.success)
      return this.#cacheReject(command, "INVALID_INPUT_PAYLOAD", slotId);
    const effectiveTick = this.#tick + 1;
    const result: RealtimeRuntimeInputResult<View, Outcome> = {
      accepted: true,
      effectiveTick,
    };
    this.#lastInputSequence.set(slotId, command.inputSequence);
    this.#queued.push({
      commandId: command.commandId,
      slotId,
      inputSequence: command.inputSequence,
      effectiveTick,
      input: input.data,
    });
    this.#commands.set(command.commandId, { slotId, result });
    return result;
  }

  public async advanceTick(): Promise<
    readonly RealtimeSnapshot<View, Outcome>[]
  > {
    if (this.#definition.getOutcome(this.#state) !== null)
      return this.snapshots();
    const effectiveTick = this.#tick + 1;
    const applicable = this.#queued
      .filter((candidate) => candidate.effectiveTick === effectiveTick)
      .sort(
        (left, right) =>
          this.#players.indexOf(left.slotId) -
          this.#players.indexOf(right.slotId),
      );
    // Inputs are assigned to one server tick only. Remove the consumed
    // entries before stepping so a long-running room cannot retain every
    // input ever received.
    if (applicable.length > 0) {
      const consumed = new Set(applicable);
      for (let index = this.#queued.length - 1; index >= 0; index -= 1) {
        const queued = this.#queued[index];
        if (queued !== undefined && consumed.has(queued)) {
          this.#queued.splice(index, 1);
        }
      }
    }
    const changes = new Map<RealtimePlayerSlotId, Input>();
    for (const candidate of applicable) {
      this.#eventSequence += 1;
      await this.#replayStore.append(this.#replayId, this.#eventSequence - 1, {
        sequence: this.#eventSequence,
        tick: this.#tick,
        actorSlotId: candidate.slotId,
        input: candidate.input,
      });
      changes.set(candidate.slotId, candidate.input);
      this.#acknowledgedInputSequence.set(
        candidate.slotId,
        candidate.inputSequence,
      );
    }
    const inputs: RealtimePlayerInput<Input>[] = this.#players.flatMap(
      (slotId) => {
        const input = changes.get(slotId);
        return input === undefined ? [] : [{ slotId, input }];
      },
    );
    const next = this.#definition.step({
      state: this.#state,
      tick: this.#tick,
      inputs,
      rng: this.#rng,
    });
    this.#state = next.state;
    this.#rng = next.rng;
    this.#tick += 1;
    const outcome = this.#definition.getOutcome(this.#state);
    if (outcome !== null) {
      await this.#replayStore.complete(
        this.#replayId,
        this.#eventSequence,
        this.#tick,
        this.#rng.cursor,
        outcome,
      );
    }
    return this.snapshots();
  }

  public snapshots(): readonly RealtimeSnapshot<View, Outcome>[] {
    const outcome = this.#definition.getOutcome(this.#state);
    return this.#players.map((slotId) => ({
      type: "realtime.snapshot",
      realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
      gameId: this.#definition.manifest.id,
      gameVersion: this.#definition.manifest.gameVersion,
      roundNumber: this.#roundNumber,
      tick: this.#tick,
      viewer: { kind: "player", slotId },
      view: this.#definition.projectView({
        state: this.#state,
        viewer: { kind: "player", slotId },
      }),
      outcome,
      acknowledgedInputSequence:
        this.#acknowledgedInputSequence.get(slotId) ?? 0,
    }));
  }

  #cacheReject(
    command: RealtimeInputCommand,
    code: RealtimeErrorCode,
    slotId: RealtimePlayerSlotId,
  ): RealtimeRuntimeInputResult<View, Outcome> {
    const result = this.#reject(command.commandId, code, slotId);
    this.#commands.set(command.commandId, { slotId, result });
    return result;
  }

  #reject(
    commandId: string | undefined,
    code: RealtimeErrorCode,
    slotId: RealtimePlayerSlotId,
  ): RealtimeRuntimeInputResult<View, Outcome> {
    const snapshot = this.snapshots().find(
      (candidate) => candidate.viewer.slotId === slotId,
    );
    const rejection: RealtimeRejected = {
      type: "realtime.rejected",
      realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
      code,
      retryable: false,
      ...(commandId === undefined ? {} : { commandId }),
      acknowledgedInputSequence:
        this.#acknowledgedInputSequence.get(slotId) ?? 0,
      ...(snapshot === undefined ? {} : { snapshot }),
    };
    return { accepted: false, rejection };
  }
}

export interface RealtimeSchedulerTimer {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface RealtimeTickSchedulerOptions {
  readonly tickRate?: 60;
  readonly timer?: RealtimeSchedulerTimer;
  onTick(): Promise<void>;
  onError?(error: unknown): void;
}

const systemTimer: RealtimeSchedulerTimer = {
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};

/** Serializes fixed-cadence callbacks so a slow tick can never create two writers. */
export class RealtimeTickScheduler {
  readonly #options: Required<
    Pick<RealtimeTickSchedulerOptions, "tickRate" | "timer">
  > &
    Pick<RealtimeTickSchedulerOptions, "onTick" | "onError">;
  #handle: unknown = null;
  #queue = Promise.resolve();
  #failed = false;

  public constructor(options: RealtimeTickSchedulerOptions) {
    if (options.tickRate !== undefined && options.tickRate !== 60) {
      throw new RangeError(
        "Realtime scheduler tick rate must be exactly 60 Hz.",
      );
    }
    this.#options = {
      tickRate: options.tickRate ?? 60,
      timer: options.timer ?? systemTimer,
      onTick: options.onTick,
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    };
  }

  public start(): void {
    if (this.#handle !== null) return;
    this.#failed = false;
    this.#handle = this.#options.timer.setInterval(() => {
      this.#queue = this.#queue
        .then(this.#options.onTick)
        .catch((error: unknown) => {
          if (this.#failed) return;
          this.#failed = true;
          if (this.#handle !== null) {
            this.#options.timer.clearInterval(this.#handle);
            this.#handle = null;
          }
          this.#options.onError?.(error);
        });
    }, 1000 / this.#options.tickRate);
  }

  public async stop(): Promise<void> {
    this.halt();
    await this.#queue;
  }

  /**
   * Stops future timer callbacks without waiting for the currently queued
   * callback.  A tick may call this method from inside its own callback;
   * awaiting stop() there would wait on itself forever.
   */
  public halt(): void {
    if (this.#handle !== null) {
      this.#options.timer.clearInterval(this.#handle);
      this.#handle = null;
    }
  }
}

export interface RealtimeTicketVerification {
  readonly status: "verified";
  readonly playerSessionId: string;
  readonly userId: string | null;
}

export interface RealtimeTicketRejection {
  readonly status: "rejected";
  readonly protocolCode: Extract<
    ProtocolErrorCode,
    "UNAUTHENTICATED" | "PROTOCOL_VERSION_UNSUPPORTED"
  >;
}

export interface RealtimeTicketVerifier {
  verify(
    ticket: unknown,
  ): Promise<RealtimeTicketVerification | RealtimeTicketRejection>;
}

export interface RealtimeRuntimeClock {
  nowMilliseconds(): number;
  setTimeout(
    callback: () => void,
    delayMilliseconds: number,
  ): {
    cancel(): void;
  };
}

export interface RealtimeRuntimeIdSource {
  createRoomCode(): string;
  createReplayId(): string;
  createRngSeed(): string;
  createPlayerSlotId(index: number): RealtimePlayerSlotId;
}

/** Platform-owned entropy used for room decisions such as RANDOM starter.
 * It is deliberately separate from the simulation RNG so starter selection
 * cannot consume or perturb a game's replay RNG stream. */
export interface RealtimePlatformRandom {
  nextBoolean(): boolean;
}

const realtimeRoomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const secureRealtimeRuntimeIdSource: RealtimeRuntimeIdSource = {
  createRoomCode() {
    const bytes = randomBytes(8);
    return [...bytes]
      .map((byte) => realtimeRoomCodeAlphabet[byte & 31])
      .join("");
  },
  createReplayId: () => randomUUID(),
  createRngSeed: () => randomBytes(32).toString("base64url"),
  createPlayerSlotId: (index) =>
    defineRealtimePlayerSlotId(
      `slot-${index + 1}-${randomBytes(6).toString("base64url")}`,
    ),
};

export const secureRealtimePlatformRandom: RealtimePlatformRandom = {
  nextBoolean() {
    // Rejection sampling avoids introducing a modulo bias while keeping the
    // source independent from the deterministic game RNG.
    for (;;) {
      const byte = randomBytes(1)[0];
      if (byte === undefined) continue;
      if (byte < 128) return false;
      if (byte >= 128) return true;
    }
  },
};

export interface RealtimeStoredPlayerSlot {
  readonly slotId: string;
  readonly playerSessionId: string | null;
  readonly userId: string | null;
  readonly reservedUntilMilliseconds: number | null;
}

export interface RealtimeStoredRound {
  readonly roundNumber: number;
  readonly replayId: string;
  readonly playerOrder: readonly string[];
  readonly tick: number;
  readonly status: "active" | "completed" | "abandoned";
  readonly outcome: JsonValue | null;
}

export interface RealtimeStoredRoom {
  readonly roomId: string;
  readonly roomCode: string;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly initialConfig: JsonValue;
  readonly players: readonly RealtimeStoredPlayerSlot[];
  readonly currentRound: RealtimeStoredRound | null;
  readonly closeReason: RoomCloseReason | null;
}

export interface RealtimeRoomStore {
  create(room: RealtimeStoredRoom): Promise<void>;
  save(room: RealtimeStoredRoom): Promise<void>;
  getByRoomCode(roomCode: string): Promise<RealtimeStoredRoom | null>;
}

export class InMemoryRealtimeRoomStore implements RealtimeRoomStore {
  readonly #rooms = new Map<string, RealtimeStoredRoom>();

  public async create(room: RealtimeStoredRoom): Promise<void> {
    if (this.#rooms.has(room.roomCode)) {
      throw new Error("Realtime room code already exists.");
    }
    this.#rooms.set(room.roomCode, cloneJson(room));
  }

  public async save(room: RealtimeStoredRoom): Promise<void> {
    if (!this.#rooms.has(room.roomCode)) {
      throw new Error("Realtime room does not exist.");
    }
    this.#rooms.set(room.roomCode, cloneJson(room));
  }

  public async getByRoomCode(
    roomCode: string,
  ): Promise<RealtimeStoredRoom | null> {
    const room = this.#rooms.get(roomCode.trim().toUpperCase());
    return room === undefined ? null : cloneJson(room);
  }
}

export interface RealtimeMatchArchive {
  createRound(room: RealtimeStoredRoom): Promise<void>;
  saveRound(room: RealtimeStoredRoom): Promise<void>;
}

const noopRealtimeMatchArchive: RealtimeMatchArchive = {
  createRound: async () => undefined,
  saveRound: async () => undefined,
};

export interface RealtimeGameRoomDependencies {
  readonly ticketVerifier: RealtimeTicketVerifier;
  readonly resolveCurrentDefinition: (
    gameId: string,
  ) => UnknownRealtimeGameDefinition | undefined;
  readonly resolveDefinition?: (
    gameId: string,
    gameVersion: string,
  ) => UnknownRealtimeGameDefinition | undefined;
  readonly roomStore?: RealtimeRoomStore;
  readonly replayStore: RealtimeReplayStore;
  readonly matchArchive?: RealtimeMatchArchive;
  readonly clock?: RealtimeRuntimeClock;
  readonly ids?: RealtimeRuntimeIdSource;
  readonly random?: RealtimePlatformRandom;
  readonly schedulerTimer?: RealtimeSchedulerTimer;
  readonly reconnectGraceMilliseconds?: number;
  readonly terminalRoomTtlMilliseconds?: number;
  readonly onError?: (error: unknown) => void;
}

export interface RealtimeGameRoomMetadata {
  readonly roomCode: string;
  readonly gameId: string;
  readonly gameVersion: string;
}

export type RealtimeGameRoomClass = new () => Room<{
  metadata: RealtimeGameRoomMetadata;
}>;

const systemRealtimeClock: RealtimeRuntimeClock = {
  nowMilliseconds: () => Date.now(),
  setTimeout(callback, delayMilliseconds) {
    const handle = setTimeout(callback, delayMilliseconds);
    return { cancel: () => clearTimeout(handle) };
  },
};

function realtimeProtocolError(
  code: Extract<
    ProtocolErrorCode,
    "UNAUTHENTICATED" | "PROTOCOL_VERSION_UNSUPPORTED"
  >,
): ServerError {
  return new ServerError(code === "UNAUTHENTICATED" ? 401 : 400, code);
}

function realtimeRetryable(code: RealtimeErrorCode): boolean {
  return code === "RATE_LIMITED";
}

export function createRealtimeGameRoomClass(
  dependencies: RealtimeGameRoomDependencies,
): RealtimeGameRoomClass {
  const roomStore = dependencies.roomStore ?? new InMemoryRealtimeRoomStore();
  const archive = dependencies.matchArchive ?? noopRealtimeMatchArchive;
  const clock = dependencies.clock ?? systemRealtimeClock;
  const ids = dependencies.ids ?? secureRealtimeRuntimeIdSource;
  const random = dependencies.random ?? secureRealtimePlatformRandom;
  const resolveDefinition =
    dependencies.resolveDefinition ??
    ((gameId: string, gameVersion: string) => {
      const current = dependencies.resolveCurrentDefinition(gameId);
      return current?.manifest.gameVersion === gameVersion
        ? current
        : undefined;
    });
  const reconnectGrace = dependencies.reconnectGraceMilliseconds ?? 60_000;
  if (!Number.isSafeInteger(reconnectGrace) || reconnectGrace < 0) {
    throw new RangeError("Reconnect grace must be a non-negative integer.");
  }
  const terminalRoomTtl = dependencies.terminalRoomTtlMilliseconds ?? 300_000;
  if (!Number.isSafeInteger(terminalRoomTtl) || terminalRoomTtl < 0) {
    throw new RangeError("Terminal room TTL must be a non-negative integer.");
  }

  return class RealtimeGameRoom extends Room<{
    metadata: RealtimeGameRoomMetadata;
  }> {
    #definition: UnknownRealtimeGameDefinition | undefined;
    #initialConfig: JsonValue | undefined;
    #roomCode: string | undefined;
    #creatorSessionId: string | undefined;
    #slots: Array<{
      readonly slotId: RealtimePlayerSlotId;
      playerSessionId: string | null;
      userId: string | null;
      reservedUntilMilliseconds: number | null;
      timeout: { cancel(): void } | null;
    }> = [];
    #round: RealtimeRound<
      JsonValue,
      JsonValue,
      JsonValue,
      JsonValue,
      JsonValue
    > | null = null;
    #roundNumber = 0;
    #replayId: string | null = null;
    #roundStatus: "active" | "completed" | "abandoned" | null = null;
    #outcome: JsonValue | null = null;
    #starter: "OWNER" | "NON_OWNER" | "RANDOM" | null = null;
    #ready = new Set<string>();
    #rematchOrder: readonly RealtimePlayerSlotId[] | null = null;
    #activeBySession = new Map<string, Client>();
    #commandOutcomes = new Map<string, CommandRejected | RoomLifecycleState>();
    #queue: Promise<void> = Promise.resolve();
    #scheduler: RealtimeTickScheduler | null = null;
    #terminalTimeout: { cancel(): void } | null = null;
    #playerOrder: readonly [RealtimePlayerSlotId, RealtimePlayerSlotId] | null =
      null;
    #pendingRound: {
      readonly roundNumber: number;
      readonly replayId: string;
      readonly playerOrder: readonly [
        RealtimePlayerSlotId,
        RealtimePlayerSlotId,
      ];
      readonly round: RealtimeRound<
        JsonValue,
        JsonValue,
        JsonValue,
        JsonValue,
        JsonValue
      >;
    } | null = null;
    /** A simulated tick is held here until its Match/room persistence commits. */
    #pendingRoundPersistence: {
      readonly status: "active" | "completed" | "abandoned";
      readonly outcome: JsonValue | null;
    } | null = null;
    #closedReason: RoomCloseReason | null = null;
    #disposed = false;
    #runtimeFailureHandled = false;

    public static override async onAuth(
      _token: string,
      options: unknown,
    ): Promise<{
      readonly playerSessionId: string;
      readonly userId: string | null;
    }> {
      const request = gameRoomRequestSchema.safeParse(options);
      if (!request.success) {
        const unsupported =
          options !== null &&
          typeof options === "object" &&
          "protocolVersion" in options &&
          (options as { readonly protocolVersion?: unknown })
            .protocolVersion !== PROTOCOL_VERSION;
        throw realtimeProtocolError(
          unsupported ? "PROTOCOL_VERSION_UNSUPPORTED" : "UNAUTHENTICATED",
        );
      }
      const verification = await dependencies.ticketVerifier.verify(
        request.data.ticket,
      );
      if (verification.status === "rejected") {
        throw realtimeProtocolError(verification.protocolCode);
      }
      return {
        playerSessionId: verification.playerSessionId,
        userId: verification.userId,
      };
    }

    public override async onCreate(options: unknown): Promise<void> {
      const request = createGameRoomRequestSchema.safeParse(options);
      if (!request.success) {
        const unsupported =
          options !== null &&
          typeof options === "object" &&
          "protocolVersion" in options &&
          (options as { readonly protocolVersion?: unknown })
            .protocolVersion !== PROTOCOL_VERSION;
        throw new ServerError(
          400,
          unsupported
            ? "PROTOCOL_VERSION_UNSUPPORTED"
            : "INVALID_ACTION_PAYLOAD",
        );
      }
      const verification = await dependencies.ticketVerifier.verify(
        request.data.ticket,
      );
      if (verification.status === "rejected") {
        throw realtimeProtocolError(verification.protocolCode);
      }
      const definition = dependencies.resolveCurrentDefinition(
        request.data.gameId,
      );
      if (
        definition === undefined ||
        definition.manifest.runtime !== "realtime"
      ) {
        throw new ServerError(404, "ROOM_NOT_FOUND");
      }
      const configResult = definition.configSchema.safeParse(
        request.data.initialConfig,
      );
      if (!configResult.success) {
        throw new ServerError(400, "INVALID_ACTION_PAYLOAD");
      }
      this.#definition = definition;
      this.#initialConfig = configResult.data;
      this.#roomCode = await this.#createRoomCode();
      this.#creatorSessionId = verification.playerSessionId;
      this.#slots = [0, 1].map((index) => ({
        slotId: ids.createPlayerSlotId(index),
        playerSessionId: index === 0 ? verification.playerSessionId : null,
        userId: index === 0 ? verification.userId : null,
        reservedUntilMilliseconds: null,
        timeout: null,
      }));
      this.autoDispose = false;
      this.patchRate = null;
      // Keep a second reservation available for a same-session takeover.
      // Platform slots still cap the room at two players in onJoin; Colyseus
      // maxClients is a transport reservation limit, so it must account for
      // the old and replacement connections briefly coexisting.
      this.maxClients = 4;
      this.maxMessagesPerSecond = 120;
      await roomStore.create(this.#storedRoom());
      await this.setMetadata({
        roomCode: this.#roomCode,
        gameId: definition.manifest.id,
        gameVersion: definition.manifest.gameVersion,
      });
      this.onMessage(REALTIME_INPUT_MESSAGE, (client, message: unknown) =>
        this.#enqueue(() => this.#handleInput(client, message)),
      );
      this.onMessage(ROOM_CONTROL_MESSAGE, (client, message: unknown) =>
        this.#enqueue(() => this.#handleControl(client, message)),
      );
    }

    public override async onJoin(
      client: Client,
      options: unknown,
    ): Promise<void> {
      await this.#enqueue(async () => {
        const request = gameRoomRequestSchema.safeParse(options);
        const definition = this.#requireDefinition();
        const session = this.#clientSession(client);
        const userId = this.#clientUserId(client);
        if (!request.success)
          throw new ServerError(400, "INVALID_ACTION_PAYLOAD");
        if (
          resolveDefinition(
            definition.manifest.id,
            definition.manifest.gameVersion,
          ) === undefined
        ) {
          throw new ServerError(404, "ROOM_NOT_FOUND");
        }
        if (request.data.type === "room.create") {
          if (
            request.data.gameId !== definition.manifest.id ||
            session !== this.#creatorSessionId
          ) {
            throw new ServerError(403, "NOT_A_PLAYER");
          }
        } else if (request.data.roomCode !== this.#roomCode) {
          throw new ServerError(403, "NOT_A_PLAYER");
        }
        if (this.#closedReason !== null)
          throw new ServerError(400, "MATCH_NOT_ACTIVE");
        let slot = this.#slots.find(
          (candidate) => candidate.playerSessionId === session,
        );
        if (slot !== undefined && slot.userId !== userId) {
          throw new ServerError(403, "NOT_A_PLAYER");
        }
        if (slot === undefined) {
          if (this.#roundStatus !== null || request.data.type !== "room.join") {
            throw new ServerError(
              400,
              this.#roundStatus === null ? "ROOM_FULL" : "ROOM_NOT_JOINABLE",
            );
          }
          slot = this.#slots.find(
            (candidate) => candidate.playerSessionId === null,
          );
          if (slot === undefined) throw new ServerError(400, "ROOM_FULL");
          slot.playerSessionId = session;
          slot.userId = userId;
        }
        slot.timeout?.cancel();
        slot.timeout = null;
        slot.reservedUntilMilliseconds = null;
        const previous = this.#activeBySession.get(session);
        this.#ready.delete(session);
        this.#activeBySession.set(session, client);
        client.userData = { session, userId, slotId: slot.slotId };
        if (previous !== undefined && previous !== client) {
          await previous.leave(4001, "connection replaced");
        }
        await roomStore.save(this.#storedRoom());
        this.#sendConnected(client, slot.slotId);
        this.#broadcastLifecycle();
        if (this.#round !== null) this.#sendSnapshot(client);
      });
    }

    public override async onLeave(
      client: Client,
      code?: number,
    ): Promise<void> {
      await this.#enqueue(async () => {
        const data = client.userData as
          { session?: string; slotId?: RealtimePlayerSlotId } | undefined;
        if (data?.session === undefined || data.slotId === undefined) return;
        if (this.#activeBySession.get(data.session) !== client) return;
        this.#activeBySession.delete(data.session);
        this.#ready.delete(data.session);
        if (this.#closedReason !== null || this.#disposed) return;
        const slot = this.#slots.find(
          (candidate) => candidate.slotId === data.slotId,
        );
        if (slot === undefined) return;
        if (code === CloseCode.CONSENTED) {
          if (this.#roundStatus === "completed") {
            this.#broadcastLifecycle();
          } else {
            await this.#closeRoom("PLAYER_LEFT");
          }
          return;
        }
        if (this.#roundStatus === "completed") {
          this.#broadcastLifecycle();
          return;
        }
        slot.reservedUntilMilliseconds =
          clock.nowMilliseconds() + reconnectGrace;
        slot.timeout?.cancel();
        slot.timeout = clock.setTimeout(() => {
          void this.#enqueue(() => this.#expireSlot(slot));
        }, reconnectGrace);
        await roomStore.save(this.#storedRoom());
        this.#broadcastLifecycle();
      });
    }

    public override async onDispose(): Promise<void> {
      this.#disposed = true;
      const scheduler = this.#scheduler;
      this.#scheduler = null;
      if (scheduler !== null) await scheduler.stop();
      this.#terminalTimeout?.cancel();
      this.#terminalTimeout = null;
      for (const slot of this.#slots) slot.timeout?.cancel();
    }

    #enqueue(work: () => void | Promise<void>): Promise<void> {
      const result = this.#queue.then(work, work);
      this.#queue = result.catch(() => undefined);
      return result;
    }

    async #handleInput(client: Client, raw: unknown): Promise<void> {
      const data = client.userData as
        { session?: string; slotId?: RealtimePlayerSlotId } | undefined;
      if (
        data?.session === undefined ||
        data.slotId === undefined ||
        this.#activeBySession.get(data.session) !== client
      ) {
        client.send(
          REALTIME_SERVER_MESSAGE,
          this.#rejected(undefined, "NOT_A_PLAYER"),
        );
        return;
      }
      if (this.#round === null || this.#roundStatus !== "active") {
        const commandId =
          realtimeInputCommandSchema.safeParse(raw).data?.commandId;
        client.send(
          REALTIME_SERVER_MESSAGE,
          this.#rejected(commandId, "MATCH_NOT_ACTIVE"),
        );
        return;
      }
      const result = await this.#round.receiveInput(data.slotId, raw);
      if (!result.accepted && result.rejection !== undefined) {
        client.send(REALTIME_SERVER_MESSAGE, result.rejection);
      }
    }

    async #handleControl(client: Client, raw: unknown): Promise<void> {
      const parsed = roomControlCommandSchema.safeParse(raw);
      const data = client.userData as { session?: string } | undefined;
      if (!parsed.success || data?.session === undefined) {
        client.send(SERVER_PROTOCOL_MESSAGE, {
          type: "command.rejected",
          protocolVersion: PROTOCOL_VERSION,
          code: "INVALID_ACTION_PAYLOAD",
          retryable: false,
        } satisfies CommandRejected);
        return;
      }
      const command = parsed.data;
      const key = `${data.session}:${command.commandId}`;
      const cached = this.#commandOutcomes.get(key);
      if (cached !== undefined) {
        client.send(
          cached.type === "room.lifecycle"
            ? ROOM_CONTROL_MESSAGE
            : SERVER_PROTOCOL_MESSAGE,
          cached,
        );
        return;
      }
      if (command.operation === "SELECT_STARTER") {
        if (
          data.session !== this.#creatorSessionId ||
          this.#roundStatus === "active"
        ) {
          this.#cacheControl(
            client,
            key,
            command.commandId,
            "ROOM_CONTROL_NOT_ALLOWED",
          );
          return;
        }
        if (this.#pendingRound !== null && this.#starter !== command.starter) {
          // A round whose replay/archive transaction is being retried already
          // owns its seed, order and replay id. Do not orphan it by changing
          // the starter while the transaction is pending.
          this.#cacheControl(
            client,
            key,
            command.commandId,
            "ROOM_CONTROL_NOT_ALLOWED",
          );
          return;
        }
        if (this.#starter !== command.starter) {
          this.#starter = command.starter;
          this.#ready.clear();
          this.#rematchOrder = null;
        }
      } else if (
        command.operation === "READY_FOR_ROUND" ||
        command.operation === "CANCEL_ROUND_READY"
      ) {
        if (this.#starter === null || this.#roundStatus === "active") {
          this.#cacheControl(
            client,
            key,
            command.commandId,
            "ROOM_CONTROL_NOT_ALLOWED",
          );
          return;
        }
        if (command.operation === "READY_FOR_ROUND")
          this.#ready.add(data.session);
        else this.#ready.delete(data.session);
        if (this.#ready.size === 2 && this.#allConnected()) {
          try {
            await this.#startRound();
          } catch (error) {
            dependencies.onError?.(error);
            this.#cacheControl(
              client,
              key,
              command.commandId,
              "INTERNAL_ERROR",
            );
            return;
          }
        }
      } else if (command.operation === "START_REMATCH") {
        if (this.#roundStatus !== "completed" || !this.#allConnected()) {
          this.#cacheControl(
            client,
            key,
            command.commandId,
            "ROOM_CONTROL_NOT_ALLOWED",
          );
          return;
        }
        this.#ready = new Set(
          this.#slots.flatMap((slot) =>
            slot.playerSessionId === null ? [] : [slot.playerSessionId],
          ),
        );
        const previousOrder = this.#playerOrder;
        if (previousOrder !== null) {
          this.#rematchOrder = [...previousOrder];
          const ownerSlot = this.#slots.find(
            (slot) => slot.playerSessionId === this.#creatorSessionId,
          );
          if (ownerSlot !== undefined) {
            this.#starter =
              previousOrder[0] === ownerSlot.slotId ? "OWNER" : "NON_OWNER";
          }
        }
        try {
          await this.#startRound();
        } catch (error) {
          dependencies.onError?.(error);
          this.#cacheControl(client, key, command.commandId, "INTERNAL_ERROR");
          return;
        }
      } else if (command.operation === "CLOSE_ROOM") {
        if (data.session !== this.#creatorSessionId) {
          this.#cacheControl(
            client,
            key,
            command.commandId,
            "ROOM_CONTROL_NOT_ALLOWED",
          );
          return;
        }
        await this.#closeRoom("OWNER_CLOSED");
      } else {
        this.#cacheControl(
          client,
          key,
          command.commandId,
          "ROOM_CONTROL_NOT_ALLOWED",
        );
        return;
      }
      const lifecycle = this.#lifecycle(client, command.commandId);
      this.#commandOutcomes.set(key, lifecycle);
      this.#broadcastLifecycle(client, command.commandId);
    }

    async #startRound(): Promise<void> {
      const definition = this.#requireDefinition();
      if (
        this.#closedReason !== null ||
        this.#starter === null ||
        !this.#allConnected() ||
        (this.#roundStatus !== null && this.#roundStatus !== "completed")
      ) {
        throw new Error(
          "A realtime round cannot start from the current lifecycle.",
        );
      }

      let pending = this.#pendingRound;
      if (pending === null) {
        const slots = this.#slots.map((slot) => slot.slotId) as [
          RealtimePlayerSlotId,
          RealtimePlayerSlotId,
        ];
        const baseOrder =
          this.#rematchOrder === null
            ? slots
            : this.#rematchOrder.every((slotId) => slots.includes(slotId)) &&
                new Set(this.#rematchOrder).size === 2
              ? ([this.#rematchOrder[0], this.#rematchOrder[1]] as [
                  RealtimePlayerSlotId,
                  RealtimePlayerSlotId,
                ])
              : slots;
        const ownerSlot =
          this.#slots.find(
            (slot) => slot.playerSessionId === this.#creatorSessionId,
          )?.slotId ?? slots[0];
        const otherSlot =
          baseOrder.find((slotId) => slotId !== ownerSlot) ??
          slots.find((slotId) => slotId !== ownerSlot) ??
          ownerSlot;
        const firstSlot =
          this.#starter === "OWNER"
            ? ownerSlot
            : this.#starter === "NON_OWNER"
              ? otherSlot
              : random.nextBoolean()
                ? ownerSlot
                : otherSlot;
        const firstIndex = baseOrder.indexOf(firstSlot);
        const ordered: readonly [RealtimePlayerSlotId, RealtimePlayerSlotId] =
          firstIndex === 0
            ? [baseOrder[0], baseOrder[1]]
            : [baseOrder[1], baseOrder[0]];
        const roundNumber = this.#roundNumber + 1;
        if (roundNumber > Number.MAX_SAFE_INTEGER) {
          throw new Error("Realtime room round number is exhausted.");
        }
        const replayId = ids.createReplayId();
        const round = await RealtimeRound.create({
          definition,
          config: this.#requireConfig(),
          players: ordered,
          rng: createRealtimeRng(ids.createRngSeed()),
          roundNumber,
          replayId,
          replayStore: dependencies.replayStore,
        });
        pending = { roundNumber, replayId, playerOrder: ordered, round };
        this.#pendingRound = pending;
      }

      // Archive and room persistence are intentionally retried with the same
      // pending round. This preserves replay id, seed and player order when a
      // database/archive call transiently fails.
      const pendingRoom = this.#storedRoomForRound(pending, "active", null);
      await archive.createRound(pendingRoom);
      await roomStore.save(pendingRoom);

      this.#round = pending.round;
      this.#roundNumber = pending.roundNumber;
      this.#replayId = pending.replayId;
      this.#playerOrder = pending.playerOrder;
      this.#pendingRound = null;
      this.#pendingRoundPersistence = null;
      this.#roundStatus = "active";
      this.#outcome = null;
      this.#ready.clear();
      this.#rematchOrder = null;
      this.#runtimeFailureHandled = false;
      this.#terminalTimeout?.cancel();
      this.#terminalTimeout = null;
      this.#scheduler = new RealtimeTickScheduler({
        // Timer callbacks are writers too.  Route them through the same room
        // queue as socket messages and lifecycle timeouts.
        onTick: () => this.#enqueue(() => this.#advanceRoundTick(definition)),
        ...(dependencies.schedulerTimer === undefined
          ? {}
          : { timer: dependencies.schedulerTimer }),
        onError: (error) => {
          void this.#enqueue(() => this.#handleRuntimeFailure(error));
        },
      });
      this.#scheduler.start();
      this.#broadcastLifecycle();
      this.#broadcastSnapshots();
    }

    async #advanceRoundTick(
      definition: UnknownRealtimeGameDefinition,
    ): Promise<void> {
      const round = this.#round;
      if (round === null || this.#roundStatus !== "active") return;

      // A persistence failure must not advance the simulation a second time.
      // Retry the exact same projected room on the next fixed tick instead.
      if (this.#pendingRoundPersistence !== null) {
        try {
          await this.#flushRoundPersistence();
        } catch (error) {
          dependencies.onError?.(error);
        }
        return;
      }

      // Simulation/replay failures intentionally escape to the scheduler's
      // onError handler and are converted into an abandoned round there.
      await round.advanceTick();
      const outcome = definition.getOutcome(round.state);
      this.#pendingRoundPersistence = {
        status: outcome === null ? "active" : "completed",
        outcome,
      };
      try {
        await this.#flushRoundPersistence();
      } catch (error) {
        // Keep the candidate and let a later callback retry it.  In
        // particular, do not expose a completed lifecycle before both the
        // replay-backed Match archive and room store have committed.
        dependencies.onError?.(error);
      }
    }

    async #flushRoundPersistence(): Promise<void> {
      const pending = this.#pendingRoundPersistence;
      const round = this.#round;
      const playerOrder = this.#playerOrder;
      const replayId = this.#replayId;
      if (
        pending === null ||
        round === null ||
        playerOrder === null ||
        replayId === null
      ) {
        throw new Error("Realtime round persistence is not initialized.");
      }
      const candidate = this.#storedRoomForRound(
        {
          roundNumber: this.#roundNumber,
          replayId,
          playerOrder,
          round,
        },
        pending.status,
        pending.outcome,
      );
      await archive.saveRound(candidate);
      await roomStore.save(candidate);

      this.#roundStatus = pending.status;
      this.#outcome = pending.outcome;
      this.#pendingRoundPersistence = null;
      this.#broadcastSnapshots();
      if (pending.status === "completed") {
        const scheduler = this.#scheduler;
        this.#scheduler = null;
        scheduler?.halt();
        this.#broadcastLifecycle();
        this.#terminalTimeout?.cancel();
        this.#terminalTimeout = clock.setTimeout(() => {
          void this.#enqueue(() => this.#closeRoom("REMATCH_TIMEOUT"));
        }, terminalRoomTtl);
      }
    }

    async #expireSlot(slot: {
      reservedUntilMilliseconds: number | null;
    }): Promise<void> {
      if (
        slot.reservedUntilMilliseconds === null ||
        slot.reservedUntilMilliseconds > clock.nowMilliseconds()
      )
        return;
      await this.#closeRoom("RECONNECT_TIMEOUT");
    }

    async #closeRoom(reason: RoomCloseReason): Promise<void> {
      if (this.#closedReason !== null) return;
      this.#pendingRound = null;
      if (this.#roundStatus === "active") {
        this.#roundStatus = "abandoned";
        try {
          await archive.saveRound(this.#storedRoom());
        } catch (error) {
          dependencies.onError?.(error);
        }
      }
      this.#closedReason = reason;
      const scheduler = this.#scheduler;
      this.#scheduler = null;
      if (scheduler !== null) void scheduler.stop();
      this.#terminalTimeout?.cancel();
      this.#terminalTimeout = null;
      for (const slot of this.#slots) {
        slot.timeout?.cancel();
        slot.timeout = null;
        slot.reservedUntilMilliseconds = null;
      }
      await roomStore.save(this.#storedRoom());
      this.#broadcastLifecycle();
      if (this.#roundStatus === "abandoned") this.#broadcastSnapshots();
    }

    async #handleRuntimeFailure(error: unknown): Promise<void> {
      if (this.#runtimeFailureHandled || this.#closedReason !== null) return;
      this.#runtimeFailureHandled = true;
      dependencies.onError?.(error);
      const scheduler = this.#scheduler;
      this.#scheduler = null;
      if (scheduler !== null) void scheduler.stop();
      if (this.#roundStatus === "active") {
        this.#roundStatus = "abandoned";
        this.#ready.clear();
        try {
          const stored = this.#storedRoom();
          await archive.saveRound(stored);
          await roomStore.save(stored);
        } catch (persistenceError) {
          dependencies.onError?.(persistenceError);
        }
        this.#broadcastLifecycle();
        this.#broadcastSnapshots();
      }
    }

    #sendConnected(client: Client, slotId: RealtimePlayerSlotId): void {
      client.send(SERVER_PROTOCOL_MESSAGE, {
        type: "room.connected",
        protocolVersion: PROTOCOL_VERSION,
        roomCode: this.#requireRoomCode(),
        gameId: this.#requireDefinition().manifest.id,
        gameVersion: this.#requireDefinition().manifest.gameVersion,
        playerSlotId: slotId,
      } satisfies RoomConnected);
    }

    #broadcastLifecycle(causingClient?: Client, commandId?: string): void {
      for (const client of this.#activeBySession.values()) {
        client.send(
          ROOM_CONTROL_MESSAGE,
          this.#lifecycle(
            client,
            client === causingClient ? commandId : undefined,
          ),
        );
      }
    }

    #lifecycle(client: Client, commandId?: string): RoomLifecycleState {
      const data = client.userData as { session?: string } | undefined;
      const currentRound =
        this.#roundStatus === null || this.#roundNumber === 0
          ? null
          : { roundNumber: this.#roundNumber, status: this.#roundStatus };
      const available =
        this.#closedReason === null &&
        (currentRound === null ||
          currentRound.status === "completed" ||
          currentRound.status === "abandoned");
      const nextRoundNumber =
        this.#pendingRound?.roundNumber ?? this.#roundNumber + 1;
      return {
        type: "room.lifecycle",
        protocolVersion: PROTOCOL_VERSION,
        isOwner: data?.session === this.#creatorSessionId,
        currentRound,
        nextRound: available
          ? {
              roundNumber: nextRoundNumber,
              starter: this.#starter,
              selfReady:
                data?.session !== undefined && this.#ready.has(data.session),
              readyPlayerCount: this.#ready.size,
              requiredPlayerCount: 2,
            }
          : null,
        players: this.#slots.map((slot) => ({
          slotId: slot.slotId,
          occupied: slot.playerSessionId !== null,
          online:
            slot.playerSessionId !== null &&
            this.#activeBySession.has(slot.playerSessionId),
          ready:
            slot.playerSessionId !== null &&
            this.#ready.has(slot.playerSessionId),
          assignment: null,
        })),
        closed: this.#closedReason !== null,
        closeReason: this.#closedReason,
        ...(commandId === undefined ? {} : { causedByCommandId: commandId }),
      };
    }

    #sendSnapshot(client: Client): void {
      const data = client.userData as
        { slotId?: RealtimePlayerSlotId } | undefined;
      if (data?.slotId === undefined || this.#round === null) return;
      const snapshot = this.#round
        .snapshots()
        .find((candidate) => candidate.viewer.slotId === data.slotId);
      if (snapshot !== undefined)
        client.send(REALTIME_SERVER_MESSAGE, snapshot);
    }

    #broadcastSnapshots(): void {
      for (const client of this.#activeBySession.values())
        this.#sendSnapshot(client);
    }

    #rejected(
      commandId: string | undefined,
      code: RealtimeErrorCode,
    ): RealtimeRejected {
      return {
        type: "realtime.rejected",
        realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
        ...(commandId === undefined ? {} : { commandId }),
        code,
        retryable: realtimeRetryable(code),
      };
    }

    #cacheControl(
      client: Client,
      key: string,
      commandId: string,
      code: ProtocolErrorCode,
    ): void {
      const rejection = {
        type: "command.rejected",
        protocolVersion: PROTOCOL_VERSION,
        commandId,
        code,
        retryable: false,
      } satisfies CommandRejected;
      this.#commandOutcomes.set(key, rejection);
      client.send(SERVER_PROTOCOL_MESSAGE, rejection);
    }

    #allConnected(): boolean {
      return this.#slots.every(
        (slot) =>
          slot.playerSessionId !== null &&
          this.#activeBySession.has(slot.playerSessionId),
      );
    }

    async #createRoomCode(): Promise<string> {
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const code = ids.createRoomCode().trim().toUpperCase();
        if (
          /^[A-HJ-NP-Z2-9]{8}$/u.test(code) &&
          (await roomStore.getByRoomCode(code)) === null
        )
          return code;
      }
      throw new ServerError(500, "INTERNAL_ERROR");
    }

    #clientSession(client: Client): string {
      const auth = client.auth as { playerSessionId?: unknown } | undefined;
      if (
        typeof auth?.playerSessionId !== "string" ||
        auth.playerSessionId.length === 0
      )
        throw realtimeProtocolError("UNAUTHENTICATED");
      return auth.playerSessionId;
    }

    #clientUserId(client: Client): string | null {
      const userId = (client.auth as { userId?: unknown } | undefined)?.userId;
      return userId === null
        ? null
        : typeof userId === "string"
          ? userId
          : null;
    }

    #storedRoom(): RealtimeStoredRoom {
      return {
        roomId: this.roomId,
        roomCode: this.#requireRoomCode(),
        gameId: this.#requireDefinition().manifest.id,
        gameVersion: this.#requireDefinition().manifest.gameVersion,
        initialConfig: this.#requireConfig(),
        players: this.#slots.map((slot) => ({
          slotId: slot.slotId,
          playerSessionId: slot.playerSessionId,
          userId: slot.userId,
          reservedUntilMilliseconds: slot.reservedUntilMilliseconds,
        })),
        currentRound:
          this.#round === null || this.#replayId === null
            ? null
            : {
                roundNumber: this.#roundNumber,
                replayId: this.#replayId,
                playerOrder:
                  this.#playerOrder ?? this.#slots.map((slot) => slot.slotId),
                tick: this.#round.tick,
                status: this.#roundStatus ?? "active",
                outcome: this.#outcome,
              },
        closeReason: this.#closedReason,
      };
    }

    #storedRoomForRound(
      pending: {
        readonly roundNumber: number;
        readonly replayId: string;
        readonly playerOrder: readonly [
          RealtimePlayerSlotId,
          RealtimePlayerSlotId,
        ];
        readonly round: RealtimeRound<
          JsonValue,
          JsonValue,
          JsonValue,
          JsonValue,
          JsonValue
        >;
      },
      status: "active" | "completed" | "abandoned",
      outcome: JsonValue | null,
    ): RealtimeStoredRoom {
      return {
        roomId: this.roomId,
        roomCode: this.#requireRoomCode(),
        gameId: this.#requireDefinition().manifest.id,
        gameVersion: this.#requireDefinition().manifest.gameVersion,
        initialConfig: this.#requireConfig(),
        players: this.#slots.map((slot) => ({
          slotId: slot.slotId,
          playerSessionId: slot.playerSessionId,
          userId: slot.userId,
          reservedUntilMilliseconds: slot.reservedUntilMilliseconds,
        })),
        currentRound: {
          roundNumber: pending.roundNumber,
          replayId: pending.replayId,
          playerOrder: pending.playerOrder,
          tick: pending.round.tick,
          status,
          outcome,
        },
        closeReason: this.#closedReason,
      };
    }

    #requireDefinition(): UnknownRealtimeGameDefinition {
      if (this.#definition === undefined)
        throw new Error("Realtime room is not initialized.");
      return this.#definition;
    }

    #requireConfig(): JsonValue {
      if (this.#initialConfig === undefined)
        throw new Error("Realtime room is not initialized.");
      return this.#initialConfig;
    }

    #requireRoomCode(): string {
      if (this.#roomCode === undefined) {
        throw new Error("Realtime room is not initialized.");
      }
      return this.#roomCode;
    }
  };
}

export { REALTIME_GAME_ROOM_NAME };
