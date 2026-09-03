import {
  REALTIME_PROTOCOL_VERSION,
  realtimeInputCommandSchema,
} from "@online-game-hub/protocol";
import type {
  RealtimeErrorCode,
  RealtimeInputCommand,
  RealtimeRejected,
  RealtimeSnapshot,
} from "@online-game-hub/protocol";
import type {
  JsonValue,
  RealtimeCanonicalReplay,
  RealtimeGameDefinition,
  RealtimePlayerInput,
  RealtimePlayerSlotId,
  RealtimeReplayEvent,
  RealtimeReplayHeader,
  RealtimeRngState,
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

export class InMemoryRealtimeReplayStore implements RealtimeReplayStore {
  readonly #records = new Map<string, RealtimeCanonicalReplay>();

  public async create(
    replayId: string,
    header: RealtimeReplayHeader,
  ): Promise<void> {
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
    const current = this.#records.get(replayId);
    if (current === undefined) throw new Error("Replay does not exist.");
    const existing = current.events[event.sequence - 1];
    if (existing !== undefined) {
      if (!sameJson(existing, event)) throw new Error("Replay event conflict.");
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
    RealtimeRuntimeInputResult<View, Outcome>
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
    if (cached !== undefined) return cached;
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
    this.#commands.set(command.commandId, result);
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
    this.#commands.set(command.commandId, result);
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

  public constructor(options: RealtimeTickSchedulerOptions) {
    this.#options = {
      tickRate: options.tickRate ?? 60,
      timer: options.timer ?? systemTimer,
      onTick: options.onTick,
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    };
  }

  public start(): void {
    if (this.#handle !== null) return;
    this.#handle = this.#options.timer.setInterval(() => {
      this.#queue = this.#queue
        .then(this.#options.onTick)
        .catch((error: unknown) => this.#options.onError?.(error));
    }, 1000 / this.#options.tickRate);
  }

  public async stop(): Promise<void> {
    if (this.#handle !== null) {
      this.#options.timer.clearInterval(this.#handle);
      this.#handle = null;
    }
    await this.#queue;
  }
}
