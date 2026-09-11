import { randomBytes, randomUUID } from "node:crypto";

import { CloseCode, Room, ServerError } from "@colyseus/core";
import type { Client } from "@colyseus/core";
import {
  DEFAULT_PLAYER_DISPLAY_NAME,
  GAME_SETUP_MESSAGE,
  REALTIME_GAME_ROOM_NAME,
  REALTIME_INPUT_MESSAGE,
  REALTIME_PROTOCOL_VERSION,
  REALTIME_SERVER_MESSAGE,
  ROOM_CONTROL_MESSAGE,
  ROOM_PROFILE_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  SETUP_PROTOCOL_VERSION,
  gameRoomRequestV6Schema,
  gameSetupCommandSchema,
  realtimeInputCommandSchema,
  roomControlCommandV6Schema,
  roomProfileCommandSchema,
  setupProtocolGenerationSchema,
} from "@online-game-hub/protocol";
import type {
  CommandRejectedV6,
  ProtocolErrorCode,
  RealtimeErrorCode,
  RealtimeInputCommand,
  RealtimeRejected,
  RealtimeSnapshot,
  RoomCloseReason,
  RoomConnectedV6,
  RoomControlCommandV6,
  RoomLifecycleStateV6,
  SetupProtocolGeneration,
} from "@online-game-hub/protocol";
import {
  applyRoundSetupAction,
  createSetupRng,
  finalizeRoundSetup,
  getRoundSetupReadiness,
  initializeRoundSetupCoordinator,
  projectRoundSetupView,
  setRoundSetupReady,
} from "@online-game-hub/game-setup";
import type {
  FinalizedRoundSetup,
  RoundSetupCoordinatorState,
  SetupJsonValue,
  SetupSlot,
  UnknownRoundSetupDefinition,
} from "@online-game-hub/game-setup";
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
    players.length >= 2 &&
    players.length <= 8 &&
    players.every(
      (player) =>
        isRecord(player) &&
        hasExactlyKeys(player, ["slotId"]) &&
        typeof player.slotId === "string" &&
        player.slotId.length > 0 &&
        player.slotId.length <= 128,
    ) &&
    new Set(players.map((player) => (player as { slotId: string }).slotId))
      .size === players.length
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
  readonly players: readonly RealtimePlayerSlotId[];
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
  readonly #players: readonly RealtimePlayerSlotId[];
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
    if (
      options.players.length < options.definition.manifest.minPlayers ||
      options.players.length > options.definition.manifest.maxPlayers ||
      new Set(options.players).size !== options.players.length
    ) {
      throw new RangeError("Invalid realtime participants.");
    }
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
      inputs:
        this.#definition.manifest.inputDelivery === "events"
          ? applicable.map(({ slotId, input }) => ({ slotId, input }))
          : inputs,
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
  readonly claims: {
    readonly protocolVersion: SetupProtocolGeneration;
    readonly displayName?: string | undefined;
  };
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
  createSetupRngSeed(): string;
  createRngSeed(): string;
  createPlayerSlotId(index: number): RealtimePlayerSlotId;
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
  createSetupRngSeed: () => randomBytes(32).toString("base64url"),
  createRngSeed: () => randomBytes(32).toString("base64url"),
  createPlayerSlotId: (index) =>
    defineRealtimePlayerSlotId(
      `slot-${index + 1}-${randomBytes(6).toString("base64url")}`,
    ),
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
  readonly setupProtocol: SetupProtocolGeneration;
  readonly initialConfig: JsonValue;
  readonly players: readonly RealtimeStoredPlayerSlot[];
  readonly currentRound: RealtimeStoredRound | null;
  /** Present while a Protocol V6 room offers setup for its next round. */
  readonly nextRoundSetup?: RoundSetupCoordinatorState;
  /** Present after a Protocol V6 room has started at least one round. */
  readonly previousFinalizedSetup?: FinalizedRoundSetup;
  readonly closeReason: RoomCloseReason | null;
}

/** Persisted metadata can describe a retired V5 room; it never restores a live room. */
export type RealtimeStoredRoomRecord =
  | RealtimeStoredRoom
  | (Omit<RealtimeStoredRoom, "setupProtocol"> & {
      readonly setupProtocol: 5;
    });

function validFinalizedSetup(
  setup: FinalizedRoundSetup,
  players: readonly RealtimeStoredPlayerSlot[],
): boolean {
  const participants = setup.participantSlotIds;
  const occupied = new Set(
    players
      .filter((player) => player.playerSessionId !== null)
      .map((player) => player.slotId),
  );
  const assignmentSlots = setup.assignments.map((entry) => entry.slotId);
  return (
    isJsonValue(setup.config) &&
    participants.length > 0 &&
    new Set(participants).size === participants.length &&
    participants.every((slotId) => occupied.has(slotId)) &&
    setup.playerOrder.length === participants.length &&
    new Set(setup.playerOrder).size === setup.playerOrder.length &&
    setup.playerOrder.every((slotId) => participants.includes(slotId)) &&
    assignmentSlots.length === participants.length &&
    new Set(assignmentSlots).size === assignmentSlots.length &&
    assignmentSlots.every((slotId) => participants.includes(slotId)) &&
    setup.assignments.every(
      (entry) =>
        entry.assignment === null ||
        (typeof entry.assignment === "string" && entry.assignment.length > 0),
    )
  );
}

function validRoundSetup(
  setup: RoundSetupCoordinatorState,
  players: readonly RealtimeStoredPlayerSlot[],
): boolean {
  const slotIds = new Set(players.map((player) => player.slotId));
  return (
    setup.schemaVersion === 1 &&
    isJsonValue(setup.setupState) &&
    Number.isSafeInteger(setup.setupRevision) &&
    setup.setupRevision >= 0 &&
    setup.setupRng.algorithm === "fnv1a32-counter-v1" &&
    setup.setupRng.seed.length > 0 &&
    Number.isSafeInteger(setup.setupRng.cursor) &&
    setup.setupRng.cursor >= 0 &&
    new Set(setup.readySlotIds).size === setup.readySlotIds.length &&
    setup.readySlotIds.every((slotId) => slotIds.has(slotId)) &&
    (setup.finalizedSetup === null ||
      validFinalizedSetup(setup.finalizedSetup, players))
  );
}

function validRealtimeStoredRoom(room: RealtimeStoredRoom): boolean {
  const setupProtocol = setupProtocolGenerationSchema.safeParse(
    room.setupProtocol,
  );
  if (!setupProtocol.success || !isJsonValue(room.initialConfig)) return false;
  if (
    room.nextRoundSetup !== undefined &&
    !validRoundSetup(room.nextRoundSetup, room.players)
  ) {
    return false;
  }
  if (
    room.previousFinalizedSetup !== undefined &&
    !validFinalizedSetup(room.previousFinalizedSetup, room.players)
  ) {
    return false;
  }
  if (room.currentRound === null) {
    return room.nextRoundSetup !== undefined;
  }
  if (room.previousFinalizedSetup === undefined) return false;
  return (
    room.closeReason !== null ||
    room.currentRound.status === "active" ||
    room.nextRoundSetup !== undefined
  );
}

export interface RealtimeRoomStore {
  create(room: RealtimeStoredRoom): Promise<void>;
  save(room: RealtimeStoredRoom): Promise<void>;
  getByRoomCode(roomCode: string): Promise<RealtimeStoredRoomRecord | null>;
}

export class InMemoryRealtimeRoomStore implements RealtimeRoomStore {
  readonly #rooms = new Map<string, RealtimeStoredRoom>();

  public async create(room: RealtimeStoredRoom): Promise<void> {
    if (!validRealtimeStoredRoom(room)) {
      throw new TypeError("Invalid realtime room.");
    }
    if (this.#rooms.has(room.roomCode)) {
      throw new Error("Realtime room code already exists.");
    }
    this.#rooms.set(room.roomCode, cloneJson(room));
  }

  public async save(room: RealtimeStoredRoom): Promise<void> {
    if (!setupProtocolGenerationSchema.safeParse(room.setupProtocol).success) {
      throw new TypeError("Invalid realtime room.");
    }
    const existing = this.#rooms.get(room.roomCode);
    if (existing === undefined) {
      throw new Error("Realtime room does not exist.");
    }
    if (existing.setupProtocol !== room.setupProtocol) {
      throw new Error("Realtime room setup protocol cannot change.");
    }
    if (!validRealtimeStoredRoom(room)) {
      throw new TypeError("Invalid realtime room.");
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
  readonly resolveRoundSetupDefinition: (
    gameId: string,
    gameVersion: string,
  ) => UnknownRoundSetupDefinition | undefined;
  readonly resolveSetupProtocol: (
    gameId: string,
    gameVersion: string,
  ) => SetupProtocolGeneration | undefined;
  readonly roomStore?: RealtimeRoomStore;
  readonly replayStore: RealtimeReplayStore;
  readonly matchArchive?: RealtimeMatchArchive;
  readonly clock?: RealtimeRuntimeClock;
  readonly ids?: RealtimeRuntimeIdSource;
  readonly schedulerTimer?: RealtimeSchedulerTimer;
  readonly reconnectGraceMilliseconds?: number;
  readonly terminalRoomTtlMilliseconds?: number;
  readonly onError?: (error: unknown) => void;
}

export interface RealtimeGameRoomMetadata {
  readonly roomCode: string;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly setupProtocol: SetupProtocolGeneration;
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

type RealtimeGameRoomRequest = ReturnType<typeof gameRoomRequestV6Schema.parse>;

function requestedProtocolVersion(input: unknown): unknown {
  return input !== null &&
    typeof input === "object" &&
    "protocolVersion" in input
    ? (input as { readonly protocolVersion?: unknown }).protocolVersion
    : undefined;
}

function parseRealtimeGameRoomRequest(
  input: unknown,
): RealtimeGameRoomRequest | null {
  const result = gameRoomRequestV6Schema.safeParse(input);
  return result.success ? result.data : null;
}

function requestProtocolCode(
  input: unknown,
  fallback: ProtocolErrorCode,
): ProtocolErrorCode {
  const version = requestedProtocolVersion(input);
  return version !== undefined && version !== SETUP_PROTOCOL_VERSION
    ? "PROTOCOL_VERSION_UNSUPPORTED"
    : fallback;
}

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

function protocolRetryable(code: ProtocolErrorCode): boolean {
  return (
    code === "STALE_REVISION" ||
    code === "STALE_SETUP_REVISION" ||
    code === "SETUP_NOT_READY" ||
    code === "RATE_LIMITED"
  );
}

export function createRealtimeGameRoomClass(
  dependencies: RealtimeGameRoomDependencies,
): RealtimeGameRoomClass {
  const roomStore = dependencies.roomStore ?? new InMemoryRealtimeRoomStore();
  const archive = dependencies.matchArchive ?? noopRealtimeMatchArchive;
  const clock = dependencies.clock ?? systemRealtimeClock;
  const ids = dependencies.ids ?? secureRealtimeRuntimeIdSource;
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
    #setupProtocol: SetupProtocolGeneration | undefined;
    #setupDefinition: UnknownRoundSetupDefinition | null = null;
    #nextRoundSetup: RoundSetupCoordinatorState | null = null;
    #previousFinalizedSetup: FinalizedRoundSetup | null = null;
    #roomCode: string | undefined;
    #creatorSessionId: string | undefined;
    #slots: Array<{
      readonly slotId: RealtimePlayerSlotId;
      playerSessionId: string | null;
      userId: string | null;
      displayName: string | null;
      reservedUntilMilliseconds: number | null;
      timeout: { cancel(): void } | null;
    }> = [];
    readonly #profileCommands = new Set<string>();
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
    #activeBySession = new Map<string, Client>();
    #commandOutcomes = new Map<
      string,
      CommandRejectedV6 | RoomLifecycleStateV6
    >();
    #queue: Promise<void> = Promise.resolve();
    #scheduler: RealtimeTickScheduler | null = null;
    #terminalTimeout: { cancel(): void } | null = null;
    #playerOrder: readonly RealtimePlayerSlotId[] | null = null;
    #pendingRound: {
      readonly roundNumber: number;
      readonly replayId: string;
      readonly config: JsonValue;
      readonly finalizedSetup: FinalizedRoundSetup;
      readonly playerOrder: readonly RealtimePlayerSlotId[];
      readonly round: RealtimeRound<
        JsonValue,
        JsonValue,
        JsonValue,
        JsonValue,
        JsonValue
      >;
    } | null = null;
    #pendingNextRoundSetup: RoundSetupCoordinatorState | null = null;
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
      readonly displayName?: string;
    }> {
      const request = parseRealtimeGameRoomRequest(options);
      if (request === null) {
        const requested = requestedProtocolVersion(options);
        const unsupported = requested !== SETUP_PROTOCOL_VERSION;
        throw realtimeProtocolError(
          unsupported ? "PROTOCOL_VERSION_UNSUPPORTED" : "UNAUTHENTICATED",
        );
      }
      const verification = await dependencies.ticketVerifier.verify(
        request.ticket,
      );
      if (verification.status === "rejected") {
        throw realtimeProtocolError(verification.protocolCode);
      }
      if (verification.claims.protocolVersion !== request.protocolVersion) {
        throw realtimeProtocolError("PROTOCOL_VERSION_UNSUPPORTED");
      }
      return {
        playerSessionId: verification.playerSessionId,
        userId: verification.userId,
        ...(verification.claims.displayName === undefined
          ? {}
          : { displayName: verification.claims.displayName }),
      };
    }

    public override async onCreate(options: unknown): Promise<void> {
      const genericRequest = parseRealtimeGameRoomRequest(options);
      if (genericRequest === null || genericRequest.type !== "room.create") {
        const requested = requestedProtocolVersion(options);
        const unsupported = requested !== SETUP_PROTOCOL_VERSION;
        throw new ServerError(
          400,
          unsupported
            ? "PROTOCOL_VERSION_UNSUPPORTED"
            : "INVALID_ACTION_PAYLOAD",
        );
      }
      const definition = dependencies.resolveCurrentDefinition(
        genericRequest.gameId,
      );
      if (
        definition === undefined ||
        definition.manifest.runtime !== "realtime"
      ) {
        throw new ServerError(404, "ROOM_NOT_FOUND");
      }
      const setupProtocol = dependencies.resolveSetupProtocol(
        definition.manifest.id,
        definition.manifest.gameVersion,
      );
      if (setupProtocol !== SETUP_PROTOCOL_VERSION) {
        throw new ServerError(500, "INTERNAL_ERROR");
      }
      const request = genericRequest;
      const verification = await dependencies.ticketVerifier.verify(
        request.ticket,
      );
      if (verification.status === "rejected") {
        throw realtimeProtocolError(verification.protocolCode);
      }
      if (verification.claims.protocolVersion !== setupProtocol) {
        throw realtimeProtocolError("PROTOCOL_VERSION_UNSUPPORTED");
      }
      const configResult = definition.configSchema.safeParse(
        request.initialConfig,
      );
      if (!configResult.success) {
        throw new ServerError(400, "INVALID_ACTION_PAYLOAD");
      }
      this.#definition = definition;
      this.#initialConfig = configResult.data;
      this.#setupProtocol = setupProtocol;
      this.#roomCode = await this.#createRoomCode();
      this.#creatorSessionId = verification.playerSessionId;
      this.#slots = Array.from(
        { length: definition.manifest.maxPlayers },
        (_, index) => ({
          slotId: ids.createPlayerSlotId(index),
          playerSessionId: index === 0 ? verification.playerSessionId : null,
          userId: index === 0 ? verification.userId : null,
          displayName:
            index === 0
              ? (verification.claims.displayName ?? DEFAULT_PLAYER_DISPLAY_NAME)
              : null,
          reservedUntilMilliseconds: null,
          timeout: null,
        }),
      );
      const setupDefinition = dependencies.resolveRoundSetupDefinition(
        definition.manifest.id,
        definition.manifest.gameVersion,
      );
      if (setupDefinition === undefined) {
        throw new ServerError(500, "INTERNAL_ERROR");
      }
      this.#setupDefinition = setupDefinition;
      try {
        this.#nextRoundSetup = initializeRoundSetupCoordinator(
          setupDefinition,
          {
            source: {
              kind: "defaults",
              config: configResult.data as SetupJsonValue,
            },
            slots: this.#setupSlots(true),
          },
          createSetupRng(ids.createSetupRngSeed()),
        );
      } catch {
        throw new ServerError(500, "INTERNAL_ERROR");
      }
      this.autoDispose = false;
      this.patchRate = null;
      // Keep a second reservation available for a same-session takeover.
      // Platform slots cap participants in onJoin; Colyseus
      // maxClients is a transport reservation limit, so it must account for
      // the old and replacement connections briefly coexisting.
      this.maxClients = definition.manifest.maxPlayers * 2;
      this.maxMessagesPerSecond = 120;
      await roomStore.create(this.#storedRoom());
      await this.setMetadata({
        roomCode: this.#roomCode,
        gameId: definition.manifest.id,
        gameVersion: definition.manifest.gameVersion,
        setupProtocol,
      });
      this.onMessage(REALTIME_INPUT_MESSAGE, (client, message: unknown) =>
        this.#enqueue(() => this.#handleInput(client, message)),
      );
      this.onMessage(ROOM_CONTROL_MESSAGE, (client, message: unknown) =>
        this.#enqueue(() => this.#handleControl(client, message)),
      );
      this.onMessage(ROOM_PROFILE_MESSAGE, (client, message: unknown) =>
        this.#enqueue(() => this.#handleProfile(client, message)),
      );
      this.onMessage(GAME_SETUP_MESSAGE, (client, message: unknown) =>
        this.#enqueue(() => this.#handleSetup(client, message)),
      );
    }

    public override async onJoin(
      client: Client,
      options: unknown,
    ): Promise<void> {
      await this.#enqueue(async () => {
        const request = parseRealtimeGameRoomRequest(options);
        const definition = this.#requireDefinition();
        const session = this.#clientSession(client);
        const userId = this.#clientUserId(client);
        if (
          request === null ||
          request.protocolVersion !== this.#requireSetupProtocol()
        )
          throw new ServerError(
            400,
            requestProtocolCode(options, "INVALID_ACTION_PAYLOAD"),
          );
        if (
          resolveDefinition(
            definition.manifest.id,
            definition.manifest.gameVersion,
          ) === undefined
        ) {
          throw new ServerError(404, "ROOM_NOT_FOUND");
        }
        if (request.type === "room.create") {
          if (
            request.gameId !== definition.manifest.id ||
            session !== this.#creatorSessionId
          ) {
            throw new ServerError(403, "NOT_A_PLAYER");
          }
        } else if (request.roomCode !== this.#roomCode) {
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
          if (this.#roundStatus !== null || request.type !== "room.join") {
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
        const profile = client.auth as { displayName?: string };
        slot.displayName =
          profile.displayName ??
          slot.displayName ??
          DEFAULT_PLAYER_DISPLAY_NAME;
        slot.timeout?.cancel();
        slot.timeout = null;
        slot.reservedUntilMilliseconds = null;
        const previous = this.#activeBySession.get(session);
        this.#clearReadyForSlot(slot.slotId);
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
        const readinessChanged = this.#clearReadyForSlot(data.slotId);
        if (this.#closedReason !== null || this.#disposed) return;
        const slot = this.#slots.find(
          (candidate) => candidate.slotId === data.slotId,
        );
        if (slot === undefined) return;
        if (code === CloseCode.CONSENTED) {
          if (this.#roundStatus === "completed") {
            if (readinessChanged) await roomStore.save(this.#storedRoom());
            this.#broadcastLifecycle();
          } else {
            await this.#closeRoom("PLAYER_LEFT");
          }
          return;
        }
        if (this.#roundStatus === "completed") {
          if (readinessChanged) await roomStore.save(this.#storedRoom());
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

    async #handleProfile(client: Client, raw: unknown): Promise<void> {
      const parsed = roomProfileCommandSchema.safeParse(raw);
      if (!parsed.success) {
        this.#sendProtocolRejection(
          client,
          requestProtocolCode(raw, "INVALID_ACTION_PAYLOAD"),
        );
        return;
      }
      const command = parsed.data;
      if (command.protocolVersion !== this.#requireSetupProtocol()) {
        this.#sendProtocolRejection(
          client,
          "PROTOCOL_VERSION_UNSUPPORTED",
          command.commandId,
        );
        return;
      }
      const data = client.userData as
        { session?: string; slotId?: RealtimePlayerSlotId } | undefined;
      const slot = this.#slots.find(
        (candidate) => candidate.slotId === data?.slotId,
      );
      if (
        data?.session === undefined ||
        slot === undefined ||
        this.#activeBySession.get(data.session) !== client ||
        slot.playerSessionId !== data.session
      ) {
        this.#sendProtocolRejection(client, "NOT_A_PLAYER", command.commandId);
        return;
      }
      if (this.#closedReason !== null) {
        this.#sendProtocolRejection(
          client,
          "MATCH_NOT_ACTIVE",
          command.commandId,
        );
        return;
      }
      const key = `${data.session}\u0000${command.commandId}`;
      if (this.#profileCommands.has(key)) {
        client.send(
          ROOM_CONTROL_MESSAGE,
          this.#lifecycle(client, command.commandId),
        );
        return;
      }
      try {
        const verified = await dependencies.ticketVerifier.verify(
          command.ticket,
        );
        if (verified.status === "rejected") {
          this.#sendProtocolRejection(
            client,
            verified.protocolCode,
            command.commandId,
          );
          return;
        }
        if (verified.claims.protocolVersion !== this.#requireSetupProtocol()) {
          this.#sendProtocolRejection(
            client,
            "PROTOCOL_VERSION_UNSUPPORTED",
            command.commandId,
          );
          return;
        }
        if (
          verified.playerSessionId !== data.session ||
          verified.userId !== slot.userId
        ) {
          this.#sendProtocolRejection(
            client,
            "NOT_A_PLAYER",
            command.commandId,
          );
          return;
        }
        if (verified.claims.displayName === undefined) {
          this.#sendProtocolRejection(
            client,
            "INVALID_ACTION_PAYLOAD",
            command.commandId,
          );
          return;
        }
        slot.displayName = verified.claims.displayName;
        this.#profileCommands.add(key);
        this.#broadcastLifecycle(client, command.commandId);
      } catch {
        this.#sendProtocolRejection(
          client,
          "INTERNAL_ERROR",
          command.commandId,
        );
      }
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

    async #handleSetup(client: Client, raw: unknown): Promise<void> {
      const parsed = gameSetupCommandSchema.safeParse(raw);
      if (!parsed.success) {
        this.#sendProtocolRejection(
          client,
          requestProtocolCode(raw, "INVALID_SETUP_PAYLOAD"),
        );
        return;
      }
      const command = parsed.data;
      const data = client.userData as
        { session?: string; slotId?: RealtimePlayerSlotId } | undefined;
      if (
        data?.session === undefined ||
        data.slotId === undefined ||
        this.#activeBySession.get(data.session) !== client
      ) {
        this.#sendProtocolRejection(client, "NOT_A_PLAYER", command.commandId);
        return;
      }
      const key = `${data.session}:${command.commandId}`;
      const cached = this.#commandOutcomes.get(key);
      if (cached !== undefined) {
        this.#sendCommandOutcome(client, cached);
        return;
      }
      const definition = this.#setupDefinition;
      const coordinator = this.#nextRoundSetup;
      const nextRoundNumber = this.#roundNumber + 1;
      if (
        this.#closedReason !== null ||
        definition === null ||
        coordinator === null ||
        this.#roundStatus === "active" ||
        command.roundNumber !== nextRoundNumber
      ) {
        this.#rejectSetupAndCache(
          client,
          key,
          "SETUP_NOT_READY",
          command.commandId,
          coordinator?.setupRevision,
        );
        return;
      }
      const parsedAction = definition.setupActionSchema.safeParse(
        command.action,
      );
      if (!parsedAction.success) {
        this.#rejectSetupAndCache(
          client,
          key,
          "INVALID_SETUP_PAYLOAD",
          command.commandId,
          coordinator.setupRevision,
        );
        return;
      }
      let result: ReturnType<typeof applyRoundSetupAction>;
      try {
        result = applyRoundSetupAction(definition, coordinator, {
          action: parsedAction.data,
          actorSlotId: data.slotId,
          isOwner: data.session === this.#creatorSessionId,
          expectedSetupRevision: command.expectedSetupRevision,
          slots: this.#setupSlots(),
        });
      } catch {
        this.#sendProtocolRejection(
          client,
          "INTERNAL_ERROR",
          command.commandId,
        );
        return;
      }
      if (result.status === "stale") {
        this.#rejectSetupAndCache(
          client,
          key,
          "STALE_SETUP_REVISION",
          command.commandId,
          result.setupRevision,
        );
        return;
      }
      if (result.status === "rejected") {
        if (
          result.code === "INVALID_SETUP_ACTION" ||
          result.code === "INVALID_SETUP_STATE" ||
          result.code === "SETUP_REVISION_EXHAUSTED"
        ) {
          this.#sendProtocolRejection(
            client,
            "INTERNAL_ERROR",
            command.commandId,
          );
          return;
        }
        this.#rejectSetupAndCache(
          client,
          key,
          "SETUP_RULE_REJECTED",
          command.commandId,
          coordinator.setupRevision,
          result.code,
        );
        return;
      }
      try {
        await roomStore.save(
          this.#storedRoom({ nextRoundSetup: result.coordinator }),
        );
      } catch {
        this.#sendProtocolRejection(
          client,
          "INTERNAL_ERROR",
          command.commandId,
        );
        return;
      }
      this.#nextRoundSetup = result.coordinator;
      this.#pendingRound = null;
      const lifecycle = this.#lifecycle(client, command.commandId);
      this.#commandOutcomes.set(key, lifecycle);
      this.#broadcastLifecycle(client, command.commandId);
    }

    async #handleControl(client: Client, raw: unknown): Promise<void> {
      const parsed = roomControlCommandV6Schema.safeParse(raw);
      const data = client.userData as
        { session?: string; slotId?: RealtimePlayerSlotId } | undefined;
      if (
        !parsed.success ||
        data?.session === undefined ||
        data.slotId === undefined
      ) {
        this.#sendProtocolRejection(
          client,
          requestProtocolCode(raw, "INVALID_ACTION_PAYLOAD"),
        );
        return;
      }
      const command: RoomControlCommandV6 = parsed.data;
      const key = `${data.session}:${command.commandId}`;
      const cached = this.#commandOutcomes.get(key);
      if (cached !== undefined) {
        this.#sendCommandOutcome(client, cached);
        return;
      }
      if (this.#activeBySession.get(data.session) !== client) {
        this.#cacheControl(client, key, command.commandId, "NOT_A_PLAYER");
        return;
      }
      if (command.operation === "CLOSE_ROOM") {
        if (data.session !== this.#creatorSessionId) {
          this.#cacheControl(
            client,
            key,
            command.commandId,
            "ROOM_CONTROL_NOT_ALLOWED",
          );
          return;
        }
        await this.#closeRoom("OWNER_CLOSED", client, command.commandId);
        const lifecycle = this.#lifecycle(client, command.commandId);
        this.#commandOutcomes.set(key, lifecycle);
        return;
      }

      const definition = this.#setupDefinition;
      const coordinator = this.#nextRoundSetup;
      if (
        this.#closedReason !== null ||
        definition === null ||
        coordinator === null ||
        this.#roundStatus === "active"
      ) {
        this.#rejectSetupAndCache(
          client,
          key,
          "SETUP_NOT_READY",
          command.commandId,
          coordinator?.setupRevision,
        );
        return;
      }
      const setupSlots = this.#setupSlots();
      const ready = setRoundSetupReady(
        definition,
        coordinator,
        setupSlots,
        data.slotId,
        command.operation === "READY_FOR_ROUND",
      );
      if (ready.status === "rejected") {
        this.#rejectSetupAndCache(
          client,
          key,
          "SETUP_NOT_READY",
          command.commandId,
          coordinator.setupRevision,
          ready.code,
        );
        return;
      }

      let candidate = ready.coordinator;
      let shouldStart = false;
      if (command.operation === "READY_FOR_ROUND") {
        const readiness = getRoundSetupReadiness(
          definition,
          candidate,
          setupSlots,
          data.slotId,
        );
        if (
          readiness.canFinalize &&
          readiness.requiredSlotIds.every((slotId) =>
            readiness.readySlotIds.includes(slotId),
          )
        ) {
          const finalized = finalizeRoundSetup(
            definition,
            candidate,
            setupSlots,
            this.#requireDefinition().manifest.minPlayers,
            this.#requireDefinition().manifest.maxPlayers,
          );
          if (finalized.status === "rejected") {
            this.#rejectSetupAndCache(
              client,
              key,
              "SETUP_RULE_REJECTED",
              command.commandId,
              coordinator.setupRevision,
              finalized.code,
            );
            return;
          }
          if (finalized.status === "finalized") {
            candidate = finalized.coordinator;
            shouldStart = true;
          }
        }
      }

      if (candidate !== coordinator) {
        try {
          await roomStore.save(this.#storedRoom({ nextRoundSetup: candidate }));
        } catch {
          this.#sendProtocolRejection(
            client,
            "INTERNAL_ERROR",
            command.commandId,
          );
          return;
        }
        this.#nextRoundSetup = candidate;
      }
      if (shouldStart) {
        try {
          await this.#startRound();
        } catch (error) {
          dependencies.onError?.(error);
          this.#sendProtocolRejection(
            client,
            "INTERNAL_ERROR",
            command.commandId,
          );
          return;
        }
      }
      const lifecycle = this.#lifecycle(client, command.commandId);
      this.#commandOutcomes.set(key, lifecycle);
      this.#broadcastLifecycle(client, command.commandId);
      if (shouldStart) this.#broadcastSnapshots();
    }

    async #startRound(): Promise<void> {
      const definition = this.#requireDefinition();
      if (
        this.#closedReason !== null ||
        !this.#setupReadyToStart() ||
        (this.#roundStatus !== null && this.#roundStatus !== "completed")
      ) {
        throw new Error(
          "A realtime round cannot start from the current lifecycle.",
        );
      }

      let pending = this.#pendingRound;
      if (pending === null) {
        const finalizedSetup = this.#nextRoundSetup?.finalizedSetup;
        if (
          finalizedSetup === null ||
          finalizedSetup === undefined ||
          finalizedSetup.playerOrder.length < definition.manifest.minPlayers ||
          finalizedSetup.playerOrder.length > definition.manifest.maxPlayers ||
          !isJsonValue(finalizedSetup.config)
        ) {
          throw new Error("Round setup has not been finalized.");
        }
        const ordered = finalizedSetup.playerOrder.map(
          defineRealtimePlayerSlotId,
        );
        const config = finalizedSetup.config as JsonValue;
        const roundNumber = this.#roundNumber + 1;
        if (roundNumber > Number.MAX_SAFE_INTEGER) {
          throw new Error("Realtime room round number is exhausted.");
        }
        const replayId = ids.createReplayId();
        const round = await RealtimeRound.create({
          definition,
          config,
          players: ordered,
          rng: createRealtimeRng(ids.createRngSeed()),
          roundNumber,
          replayId,
          replayStore: dependencies.replayStore,
        });
        pending = {
          roundNumber,
          replayId,
          config,
          finalizedSetup,
          playerOrder: ordered,
          round,
        };
        this.#pendingRound = pending;
      }

      // Archive and room persistence are intentionally retried with the same
      // pending round. This preserves replay id, seed and player order when a
      // database/archive call transiently fails.
      const pendingRoom = this.#storedRoomForRound(pending, "active", null, {
        initialConfig: pending.config,
        nextRoundSetup: null,
        previousFinalizedSetup: pending.finalizedSetup,
      });
      await archive.createRound(pendingRoom);
      await roomStore.save(pendingRoom);

      this.#round = pending.round;
      this.#roundNumber = pending.roundNumber;
      this.#replayId = pending.replayId;
      this.#playerOrder = pending.playerOrder;
      this.#initialConfig = pending.config;
      this.#nextRoundSetup = null;
      this.#previousFinalizedSetup = pending.finalizedSetup;
      this.#pendingRound = null;
      this.#pendingNextRoundSetup = null;
      this.#pendingRoundPersistence = null;
      this.#roundStatus = "active";
      this.#outcome = null;
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
      const nextRoundSetup =
        pending.status === "completed"
          ? this.#createNextRoundSetupCandidate()
          : null;
      const candidate = this.#storedRoomForRound(
        {
          roundNumber: this.#roundNumber,
          replayId,
          playerOrder,
          round,
        },
        pending.status,
        pending.outcome,
        nextRoundSetup === null ? {} : { nextRoundSetup },
      );
      await archive.saveRound(candidate);
      await roomStore.save(candidate);

      this.#roundStatus = pending.status;
      this.#outcome = pending.outcome;
      if (nextRoundSetup !== null) {
        this.#nextRoundSetup = nextRoundSetup;
        this.#pendingNextRoundSetup = null;
      }
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

    async #closeRoom(
      reason: RoomCloseReason,
      causingClient?: Client,
      commandId?: string,
    ): Promise<void> {
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
      // Persist the last Setup for waiting/completed rooms, as required by
      // the durable metadata contract. A closed lifecycle offers no Setup.
      this.#nextRoundSetup =
        this.#nextRoundSetup !== null &&
        (this.#roundStatus === null || this.#roundStatus === "completed")
          ? { ...this.#nextRoundSetup, readySlotIds: [] }
          : null;
      this.#pendingNextRoundSetup = null;
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
      this.#broadcastLifecycle(causingClient, commandId);
      if (this.#roundStatus === "abandoned") this.#broadcastSnapshots();
      setTimeout(() => {
        if (!this.#disposed) {
          void this.disconnect(CloseCode.CONSENTED).catch(() => undefined);
        }
      }, 25);
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
        this.#pendingRoundPersistence = null;
        const nextRoundSetup = this.#createNextRoundSetupCandidate();
        // Keep a valid lifecycle if the best-effort archive write fails.
        this.#nextRoundSetup = nextRoundSetup;
        this.#pendingNextRoundSetup = null;
        try {
          const stored = this.#storedRoom({ nextRoundSetup });
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
      const shared = {
        type: "room.connected",
        roomCode: this.#requireRoomCode(),
        gameId: this.#requireDefinition().manifest.id,
        gameVersion: this.#requireDefinition().manifest.gameVersion,
        playerSlotId: slotId,
      } as const;
      const message: RoomConnectedV6 = {
        ...shared,
        protocolVersion: SETUP_PROTOCOL_VERSION,
      };
      client.send(SERVER_PROTOCOL_MESSAGE, message);
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

    #lifecycle(client: Client, commandId?: string): RoomLifecycleStateV6 {
      const data = client.userData as
        { session?: string; slotId?: RealtimePlayerSlotId } | undefined;
      const includeProfiles =
        (client.auth as { displayName?: string }).displayName !== undefined;
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
      const definition = this.#setupDefinition;
      const coordinator = this.#nextRoundSetup;
      if (
        available &&
        (definition === null ||
          coordinator === null ||
          data?.slotId === undefined)
      ) {
        throw new ServerError(500, "INTERNAL_ERROR");
      }
      let nextRound: RoomLifecycleStateV6["nextRound"] = null;
      if (
        available &&
        definition !== null &&
        coordinator !== null &&
        data?.slotId !== undefined
      ) {
        const setupView = projectRoundSetupView(
          definition,
          coordinator,
          this.#setupSlots(),
          { kind: "player", slotId: data.slotId },
        );
        const readiness = getRoundSetupReadiness(
          definition,
          coordinator,
          this.#setupSlots(),
          data.slotId,
        );
        nextRound = {
          roundNumber: nextRoundNumber,
          setupRevision: coordinator.setupRevision,
          setupView,
          readiness: {
            canReady: readiness.canReady,
            selfReady: readiness.selfReady,
            readySlotIds: [...readiness.readySlotIds],
            requiredSlotIds: [...readiness.requiredSlotIds],
          },
        };
      }
      const readySlotIds = new Set(coordinator?.readySlotIds ?? []);
      return {
        type: "room.lifecycle",
        protocolVersion: SETUP_PROTOCOL_VERSION,
        isOwner: data?.session === this.#creatorSessionId,
        currentRound,
        nextRound,
        players: this.#slots.map((slot) => ({
          slotId: slot.slotId,
          ...(includeProfiles ? { displayName: slot.displayName } : {}),
          occupied: slot.playerSessionId !== null,
          online:
            slot.playerSessionId !== null &&
            this.#activeBySession.has(slot.playerSessionId),
          ready: readySlotIds.has(slot.slotId),
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
      const rejection = this.#protocolRejection(code, commandId);
      this.#commandOutcomes.set(key, rejection);
      client.send(SERVER_PROTOCOL_MESSAGE, rejection);
    }

    #rejectSetupAndCache(
      client: Client,
      key: string,
      code: ProtocolErrorCode,
      commandId: string,
      setupRevision?: number,
      gameRuleCode?: string,
    ): void {
      const rejection = this.#protocolRejection(
        code,
        commandId,
        setupRevision,
        gameRuleCode,
      );
      this.#commandOutcomes.set(key, rejection);
      client.send(SERVER_PROTOCOL_MESSAGE, rejection);
    }

    #sendProtocolRejection(
      client: Client,
      code: ProtocolErrorCode,
      commandId?: string,
      setupRevision?: number,
    ): void {
      client.send(
        SERVER_PROTOCOL_MESSAGE,
        this.#protocolRejection(code, commandId, setupRevision),
      );
    }

    #protocolRejection(
      code: ProtocolErrorCode,
      commandId?: string,
      setupRevision?: number,
      gameRuleCode?: string,
    ): CommandRejectedV6 {
      const shared = {
        type: "command.rejected" as const,
        ...(commandId === undefined ? {} : { commandId }),
        code,
        ...(setupRevision === undefined ? {} : { setupRevision }),
        ...(gameRuleCode === undefined ? {} : { gameRuleCode }),
        retryable: protocolRetryable(code),
      };
      return { ...shared, protocolVersion: SETUP_PROTOCOL_VERSION };
    }

    #sendCommandOutcome(
      client: Client,
      outcome: CommandRejectedV6 | RoomLifecycleStateV6,
    ): void {
      client.send(
        outcome.type === "room.lifecycle"
          ? ROOM_CONTROL_MESSAGE
          : SERVER_PROTOCOL_MESSAGE,
        outcome,
      );
    }

    #setupSlots(forceOffline = false): readonly SetupSlot[] {
      return this.#slots.map((slot) => ({
        slotId: slot.slotId,
        occupied: slot.playerSessionId !== null,
        online:
          !forceOffline &&
          slot.playerSessionId !== null &&
          this.#activeBySession.has(slot.playerSessionId),
        isOwner: slot.playerSessionId === this.#creatorSessionId,
      }));
    }

    #clearReadyForSlot(slotId: string): boolean {
      if (this.#setupDefinition !== null && this.#nextRoundSetup !== null) {
        const result = setRoundSetupReady(
          this.#setupDefinition,
          this.#nextRoundSetup,
          this.#setupSlots(),
          slotId,
          false,
        );
        if (result.status !== "rejected") {
          const changed = result.coordinator !== this.#nextRoundSetup;
          this.#nextRoundSetup = result.coordinator;
          return changed;
        }
        return false;
      }
      return false;
    }

    #createNextRoundSetupCandidate(): RoundSetupCoordinatorState {
      if (this.#pendingNextRoundSetup !== null) {
        return this.#pendingNextRoundSetup;
      }
      if (
        this.#setupDefinition === null ||
        this.#previousFinalizedSetup === null
      ) {
        throw new Error("Previous realtime finalized setup is unavailable.");
      }
      const candidate = initializeRoundSetupCoordinator(
        this.#setupDefinition,
        {
          source: {
            kind: "previous-round",
            setup: this.#previousFinalizedSetup,
          },
          slots: this.#setupSlots(),
        },
        createSetupRng(ids.createSetupRngSeed()),
      );
      this.#pendingNextRoundSetup = candidate;
      return candidate;
    }

    #setupReadyToStart(): boolean {
      if (
        this.#setupDefinition === null ||
        this.#nextRoundSetup === null ||
        this.#nextRoundSetup.finalizedSetup === null
      ) {
        return false;
      }
      const readiness = getRoundSetupReadiness(
        this.#setupDefinition,
        this.#nextRoundSetup,
        this.#setupSlots(),
      );
      return (
        readiness.canFinalize &&
        readiness.requiredSlotIds.every((slotId) =>
          readiness.readySlotIds.includes(slotId),
        )
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

    #storedRoom(
      overrides: {
        readonly initialConfig?: JsonValue;
        readonly nextRoundSetup?: RoundSetupCoordinatorState | null;
        readonly previousFinalizedSetup?: FinalizedRoundSetup | null;
      } = {},
    ): RealtimeStoredRoom {
      const nextRoundSetup =
        "nextRoundSetup" in overrides
          ? (overrides.nextRoundSetup ?? null)
          : this.#nextRoundSetup;
      const previousFinalizedSetup =
        "previousFinalizedSetup" in overrides
          ? (overrides.previousFinalizedSetup ?? null)
          : this.#previousFinalizedSetup;
      return {
        roomId: this.roomId,
        roomCode: this.#requireRoomCode(),
        gameId: this.#requireDefinition().manifest.id,
        gameVersion: this.#requireDefinition().manifest.gameVersion,
        setupProtocol: this.#requireSetupProtocol(),
        initialConfig: overrides.initialConfig ?? this.#requireConfig(),
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
        ...(nextRoundSetup === null ? {} : { nextRoundSetup }),
        ...(previousFinalizedSetup === null ? {} : { previousFinalizedSetup }),
        closeReason: this.#closedReason,
      };
    }

    #storedRoomForRound(
      pending: {
        readonly roundNumber: number;
        readonly replayId: string;
        readonly playerOrder: readonly RealtimePlayerSlotId[];
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
      overrides: {
        readonly initialConfig?: JsonValue;
        readonly nextRoundSetup?: RoundSetupCoordinatorState | null;
        readonly previousFinalizedSetup?: FinalizedRoundSetup | null;
      } = {},
    ): RealtimeStoredRoom {
      const nextRoundSetup =
        "nextRoundSetup" in overrides
          ? (overrides.nextRoundSetup ?? null)
          : this.#nextRoundSetup;
      const previousFinalizedSetup =
        "previousFinalizedSetup" in overrides
          ? (overrides.previousFinalizedSetup ?? null)
          : this.#previousFinalizedSetup;
      return {
        roomId: this.roomId,
        roomCode: this.#requireRoomCode(),
        gameId: this.#requireDefinition().manifest.id,
        gameVersion: this.#requireDefinition().manifest.gameVersion,
        setupProtocol: this.#requireSetupProtocol(),
        initialConfig: overrides.initialConfig ?? this.#requireConfig(),
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
        ...(nextRoundSetup === null ? {} : { nextRoundSetup }),
        ...(previousFinalizedSetup === null ? {} : { previousFinalizedSetup }),
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

    #requireSetupProtocol(): SetupProtocolGeneration {
      if (this.#setupProtocol === undefined) {
        throw new Error("Realtime room is not initialized.");
      }
      return this.#setupProtocol;
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
