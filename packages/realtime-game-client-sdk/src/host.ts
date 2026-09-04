import { Client as ColyseusClient } from "@colyseus/sdk";
import {
  GAME_SETUP_MESSAGE,
  PROTOCOL_VERSION,
  REALTIME_GAME_ROOM_NAME,
  REALTIME_INPUT_MESSAGE,
  REALTIME_PROTOCOL_VERSION,
  REALTIME_SERVER_MESSAGE,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  SETUP_PROTOCOL_VERSION,
  commandRejectedSchema,
  commandRejectedV6Schema,
  createGameRoomRequestSchema,
  createGameRoomRequestV6Schema,
  gameSetupCommandSchema,
  gameServerTicketSchema,
  joinGameRoomRequestSchema,
  joinGameRoomRequestV6Schema,
  realtimeInputCommandSchema,
  realtimeRejectedSchema,
  realtimeSnapshotSchema,
  roomCodeSchema,
  roomConnectedSchema,
  roomConnectedV6Schema,
  roomControlCommandSchema,
  roomControlCommandV6Schema,
  roomLifecycleStateSchema,
  roomLifecycleStateV6Schema,
} from "@online-game-hub/protocol";
import type {
  CommandRejected,
  CommandRejectedV6,
  GameSetupCommand,
  RealtimeRejected,
  RealtimeSnapshot,
  RoomConnected,
  RoomConnectedV6,
  RoomLifecycleState,
  RoomLifecycleStateV6,
  RoomControlCommand,
  RoomControlCommandV6,
  StarterChoice,
} from "@online-game-hub/protocol";

import type { RealtimeClientConnectionState } from "./contracts.js";
import type { RealtimeTicketProvider } from "./ticket-provider.js";

export type RealtimeSetupProtocol =
  typeof PROTOCOL_VERSION | typeof SETUP_PROTOCOL_VERSION;

type AnyRoomConnected = RoomConnected | RoomConnectedV6;
type AnyRoomLifecycle = RoomLifecycleState | RoomLifecycleStateV6;
type AnyCommandRejected = CommandRejected | CommandRejectedV6;

export interface RealtimeTransportRoom {
  onMessage<Payload>(
    type: string | number,
    callback: (payload: Payload) => void,
  ): () => void;
  onLeave(callback: (code: number, reason?: string) => void): unknown;
  send<Payload>(type: string | number, payload: Payload): void;
  leave(consented?: boolean): Promise<number>;
}

export interface RealtimeTransportClient {
  create(roomName: string, options: unknown): Promise<RealtimeTransportRoom>;
  join(roomName: string, options: unknown): Promise<RealtimeTransportRoom>;
}

export interface RealtimeTransportFactory {
  createClient(endpoint: string): RealtimeTransportClient;
}

export const colyseusRealtimeTransportFactory: RealtimeTransportFactory = {
  createClient(endpoint) {
    return new ColyseusClient(endpoint) as RealtimeTransportClient;
  },
};

export interface RealtimeCommandIdSource {
  createCommandId(): string;
}

export const secureRealtimeCommandIdSource: RealtimeCommandIdSource = {
  createCommandId: () => globalThis.crypto.randomUUID(),
};

export interface RealtimeGameClientHostState<
  View = unknown,
  Outcome = unknown,
> {
  readonly connectionState: RealtimeClientConnectionState;
  readonly room: AnyRoomConnected | null;
  readonly roomLifecycle: AnyRoomLifecycle | null;
  readonly previousSnapshot: RealtimeSnapshot<View, Outcome> | null;
  readonly snapshot: RealtimeSnapshot<View, Outcome> | null;
  readonly rejection: RealtimeRejected | null;
  readonly controlRejection: AnyCommandRejected | null;
  readonly error:
    | "TICKET_ERROR"
    | "ROOM_ERROR"
    | "INVALID_SERVER_MESSAGE"
    | "CONNECTION_CLOSED"
    | null;
}

export interface RealtimeGameClientHostOptions {
  readonly gameServerUrl: string;
  readonly ticketProvider: RealtimeTicketProvider;
  readonly setupProtocol?: RealtimeSetupProtocol;
  readonly transport?: RealtimeTransportFactory;
  readonly commandIds?: RealtimeCommandIdSource;
  readonly reconnectWindowMilliseconds?: number;
  readonly nowMilliseconds?: () => number;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

interface PendingInput {
  readonly sequence: number;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

interface PendingControl {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

export class RealtimeCommandRejectedError extends Error {
  public constructor(public readonly rejection: RealtimeRejected) {
    super(`Realtime command was rejected with ${rejection.code}.`);
    this.name = "RealtimeCommandRejectedError";
  }
}

export class RealtimeGameClientHost<View = unknown, Outcome = unknown> {
  readonly #options: Required<
    Pick<
      RealtimeGameClientHostOptions,
      | "transport"
      | "commandIds"
      | "reconnectWindowMilliseconds"
      | "nowMilliseconds"
      | "delay"
    >
  > &
    Pick<RealtimeGameClientHostOptions, "gameServerUrl" | "ticketProvider">;
  readonly #listeners = new Set<() => void>();
  readonly #pending = new Map<string, PendingInput>();
  readonly #pendingControls = new Map<string, PendingControl>();
  /** Command ids are single-use for the lifetime of a host connection. */
  readonly #usedCommandIds = new Set<string>();
  #state: RealtimeGameClientHostState<View, Outcome> = {
    connectionState: "idle",
    room: null,
    roomLifecycle: null,
    previousSnapshot: null,
    snapshot: null,
    rejection: null,
    controlRejection: null,
    error: null,
  };
  #transportRoom: RealtimeTransportRoom | null = null;
  #expectedGameId: string | null = null;
  #inputSequence = 0;
  #closing = false;
  #target: {
    readonly gameId: string;
    readonly roomCode: string;
    readonly setupProtocol: RealtimeSetupProtocol;
  } | null = null;
  #generation = 0;
  readonly #defaultSetupProtocol: RealtimeSetupProtocol;
  #setupProtocol: RealtimeSetupProtocol;

  public constructor(options: RealtimeGameClientHostOptions) {
    if (options.gameServerUrl.length === 0)
      throw new TypeError("Game Server URL is required.");
    const setupProtocol = options.setupProtocol ?? PROTOCOL_VERSION;
    if (
      setupProtocol !== PROTOCOL_VERSION &&
      setupProtocol !== SETUP_PROTOCOL_VERSION
    ) {
      throw new RangeError("Unsupported setup protocol generation.");
    }
    this.#options = {
      gameServerUrl: options.gameServerUrl,
      ticketProvider: options.ticketProvider,
      transport: options.transport ?? colyseusRealtimeTransportFactory,
      commandIds: options.commandIds ?? secureRealtimeCommandIdSource,
      reconnectWindowMilliseconds:
        options.reconnectWindowMilliseconds ?? 60_000,
      nowMilliseconds: options.nowMilliseconds ?? Date.now,
      delay:
        options.delay ??
        ((milliseconds: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
    };
    this.#defaultSetupProtocol = setupProtocol;
    this.#setupProtocol = setupProtocol;
    if (
      !Number.isSafeInteger(this.#options.reconnectWindowMilliseconds) ||
      this.#options.reconnectWindowMilliseconds < 0
    ) {
      throw new RangeError(
        "Reconnect window must be a non-negative integer in milliseconds.",
      );
    }
  }

  public getState(): RealtimeGameClientHostState<View, Outcome> {
    return this.#state;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public async createRoom(
    gameId: string,
    initialConfig: unknown,
  ): Promise<void> {
    const setupProtocol = this.#defaultSetupProtocol;
    this.#expectedGameId = gameId;
    this.#target = null;
    this.#inputSequence = 0;
    this.#usedCommandIds.clear();
    await this.#connect(setupProtocol, (ticket, client) =>
      client.create(
        REALTIME_GAME_ROOM_NAME,
        (setupProtocol === SETUP_PROTOCOL_VERSION
          ? createGameRoomRequestV6Schema
          : createGameRoomRequestSchema
        ).parse({
          type: "room.create",
          protocolVersion: setupProtocol,
          ticket,
          gameId,
          initialConfig,
        }),
      ),
    );
  }

  public async joinRoom(
    gameId: string,
    roomCode: string,
    setupProtocol = this.#defaultSetupProtocol,
  ): Promise<void> {
    if (
      setupProtocol !== PROTOCOL_VERSION &&
      setupProtocol !== SETUP_PROTOCOL_VERSION
    ) {
      throw new RangeError("Unsupported setup protocol generation.");
    }
    this.#expectedGameId = gameId;
    const canonicalCode = roomCodeSchema.parse(roomCode.trim().toUpperCase());
    this.#target = { gameId, roomCode: canonicalCode, setupProtocol };
    this.#inputSequence = 0;
    this.#usedCommandIds.clear();
    await this.#connect(setupProtocol, (ticket, client) =>
      client.join(
        REALTIME_GAME_ROOM_NAME,
        (setupProtocol === SETUP_PROTOCOL_VERSION
          ? joinGameRoomRequestV6Schema
          : joinGameRoomRequestSchema
        ).parse({
          type: "room.join",
          protocolVersion: setupProtocol,
          ticket,
          roomCode: canonicalCode,
        }),
      ),
    );
  }

  public submitInput(input: unknown): Promise<void> {
    const room = this.#transportRoom;
    const activeRound = this.#state.roomLifecycle?.currentRound;
    if (
      room === null ||
      this.#state.connectionState !== "connected" ||
      activeRound?.status !== "active"
    ) {
      return Promise.reject(new Error("The realtime round is not active."));
    }
    const commandId = this.#options.commandIds.createCommandId();
    if (this.#usedCommandIds.has(commandId))
      return Promise.reject(new Error("Duplicate command id."));
    const inputSequence = this.#inputSequence + 1;
    if (!Number.isSafeInteger(inputSequence))
      return Promise.reject(new Error("Realtime input sequence is exhausted."));
    const command = realtimeInputCommandSchema.parse({
      type: "realtime.input",
      realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
      commandId,
      roundNumber: activeRound.roundNumber,
      inputSequence,
      input,
    });
    this.#usedCommandIds.add(commandId);
    this.#inputSequence = inputSequence;
    return new Promise<void>((resolve, reject) => {
      this.#pending.set(commandId, {
        sequence: inputSequence,
        resolve,
        reject,
      });
      try {
        room.send(REALTIME_INPUT_MESSAGE, command);
      } catch {
        this.#pending.delete(commandId);
        reject(new Error("Realtime input could not be sent."));
      }
    });
  }

  public selectStarter(starter: StarterChoice): Promise<void> {
    if (this.#setupProtocol === SETUP_PROTOCOL_VERSION) {
      return this.submitSetup({ type: "SELECT_STARTER", starter });
    }
    return this.#sendControl({ operation: "SELECT_STARTER", starter });
  }

  public readyForRound(): Promise<void> {
    return this.#sendControl({ operation: "READY_FOR_ROUND" });
  }

  public cancelRoundReady(): Promise<void> {
    return this.#sendControl({ operation: "CANCEL_ROUND_READY" });
  }

  public startRematch(): Promise<void> {
    if (this.#setupProtocol === SETUP_PROTOCOL_VERSION) {
      return this.readyForRound();
    }
    return this.#sendControl({ operation: "START_REMATCH" });
  }

  public closeRoom(): Promise<void> {
    return this.#sendControl({ operation: "CLOSE_ROOM" });
  }

  public submitSetup(action: unknown): Promise<void> {
    if (this.#setupProtocol !== SETUP_PROTOCOL_VERSION) {
      return Promise.reject(
        new Error("Game-defined setup requires protocol version 6."),
      );
    }
    const room = this.#transportRoom;
    const nextRound = this.#state.roomLifecycle?.nextRound;
    if (
      room === null ||
      this.#state.connectionState !== "connected" ||
      nextRound === null ||
      nextRound === undefined ||
      !("setupRevision" in nextRound)
    ) {
      return Promise.reject(new Error("Round setup is not available."));
    }
    const commandId = this.#options.commandIds.createCommandId();
    if (this.#usedCommandIds.has(commandId)) {
      return Promise.reject(new Error("Duplicate command id."));
    }
    const command = gameSetupCommandSchema.parse({
      type: "game.setup",
      protocolVersion: SETUP_PROTOCOL_VERSION,
      commandId,
      roundNumber: nextRound.roundNumber,
      expectedSetupRevision: nextRound.setupRevision,
      action,
    }) satisfies GameSetupCommand;
    this.#usedCommandIds.add(commandId);
    return new Promise<void>((resolve, reject) => {
      this.#pendingControls.set(commandId, { resolve, reject });
      try {
        room.send(GAME_SETUP_MESSAGE, command);
      } catch {
        this.#pendingControls.delete(commandId);
        reject(new Error("Realtime round setup could not be sent."));
      }
    });
  }

  public async leaveRoom(): Promise<void> {
    this.#closing = true;
    this.#generation += 1;
    const room = this.#transportRoom;
    this.#transportRoom = null;
    this.#target = null;
    this.#expectedGameId = null;
    this.#inputSequence = 0;
    this.#usedCommandIds.clear();
    this.#rejectPending("The realtime room was left.");
    this.#replace({
      connectionState: "idle",
      room: null,
      roomLifecycle: null,
      previousSnapshot: null,
      snapshot: null,
      rejection: null,
      controlRejection: null,
      error: null,
    });
    if (room !== null) await room.leave(true).catch(() => 0);
  }

  public async close(): Promise<void> {
    this.#closing = true;
    this.#generation += 1;
    const room = this.#transportRoom;
    this.#transportRoom = null;
    this.#target = null;
    this.#usedCommandIds.clear();
    this.#rejectPending("The realtime connection was closed.");
    this.#replace({ ...this.#state, connectionState: "closed" });
    if (room !== null) await room.leave(false).catch(() => 0);
  }

  async #connect(
    setupProtocol: RealtimeSetupProtocol,
    reserve: (
      ticket: string,
      client: RealtimeTransportClient,
    ) => Promise<RealtimeTransportRoom>,
  ): Promise<void> {
    this.#closing = false;
    this.#generation += 1;
    const generation = this.#generation;
    this.#setupProtocol = setupProtocol;
    this.#rejectPending("The previous realtime connection was replaced.");
    this.#replace({ ...this.#state, connectionState: "loading", error: null });
    let ticket: string;
    try {
      ticket = gameServerTicketSchema.parse(
        await this.#options.ticketProvider(setupProtocol),
      );
    } catch {
      if (generation === this.#generation) this.#fail("TICKET_ERROR");
      return;
    }
    if (generation !== this.#generation || this.#closing) return;
    try {
      this.#replace({ ...this.#state, connectionState: "connecting" });
      const room = await reserve(
        ticket,
        this.#options.transport.createClient(this.#options.gameServerUrl),
      );
      if (generation !== this.#generation || this.#closing) {
        await room.leave(false).catch(() => 0);
        return;
      }
      this.#bind(room, generation);
    } catch {
      if (generation === this.#generation) this.#fail("ROOM_ERROR");
    }
  }

  #bind(room: RealtimeTransportRoom, generation: number): void {
    this.#transportRoom = room;
    room.onMessage<unknown>(SERVER_PROTOCOL_MESSAGE, (payload) => {
      if (generation === this.#generation) this.#handleServerMessage(payload);
    });
    room.onMessage<unknown>(ROOM_CONTROL_MESSAGE, (payload) => {
      if (generation === this.#generation) this.#handleLifecycle(payload);
    });
    room.onMessage<unknown>(REALTIME_SERVER_MESSAGE, (payload) => {
      const snapshot = realtimeSnapshotSchema.safeParse(payload);
      if (snapshot.success) {
        this.#applySnapshot(snapshot.data as RealtimeSnapshot<View, Outcome>);
        return;
      }
      const rejection = realtimeRejectedSchema.safeParse(payload);
      if (!rejection.success) {
        this.#failProtocol();
        return;
      }
      const value = rejection.data as RealtimeRejected;
      // A rejected command must reject its promise even when the server also
      // includes a snapshot acknowledging newer input. Apply the snapshot
      // first without settling pending commands, then expose the rejection.
      if (value.commandId !== undefined) {
        const pending = this.#pending.get(value.commandId);
        if (pending !== undefined) {
          this.#pending.delete(value.commandId);
          pending.reject(new RealtimeCommandRejectedError(value));
        }
      }
      if (value.snapshot !== undefined) {
        this.#applySnapshot(
          value.snapshot as RealtimeSnapshot<View, Outcome>,
          false,
          false,
        );
      }
      if (value.acknowledgedInputSequence !== undefined) {
        this.#inputSequence = Math.max(
          this.#inputSequence,
          value.acknowledgedInputSequence,
        );
      }
      this.#replace({ ...this.#state, rejection: value, error: null });
    });
    room.onLeave(() => {
      if (
        generation !== this.#generation ||
        this.#closing ||
        this.#transportRoom !== room
      )
        return;
      this.#transportRoom = null;
      this.#rejectPending("The realtime connection closed.");
      if (this.#state.roomLifecycle?.closed === true) {
        this.#fail("CONNECTION_CLOSED");
        return;
      }
      void this.#reconnect();
    });
  }

  #applySnapshot(
    snapshot: RealtimeSnapshot<View, Outcome>,
    clearRejection = true,
    settlePending = true,
  ): void {
    const room = this.#state.room;
    const lifecycleRound = this.#state.roomLifecycle?.currentRound;
    if (
      room === null ||
      snapshot.gameId !== room.gameId ||
      snapshot.gameVersion !== room.gameVersion ||
      snapshot.viewer.slotId !== room.playerSlotId ||
      lifecycleRound === null ||
      lifecycleRound === undefined ||
      snapshot.roundNumber !== lifecycleRound.roundNumber
    ) {
      this.#failProtocol();
      return;
    }
    const current = this.#state.snapshot;
    if (current !== null && snapshot.tick < current.tick) return;
    if (
      current !== null &&
      snapshot.acknowledgedInputSequence < current.acknowledgedInputSequence
    ) {
      return;
    }
    const advanced = current === null || snapshot.tick > current.tick;
    this.#replace({
      ...this.#state,
      previousSnapshot: advanced ? current : this.#state.previousSnapshot,
      snapshot,
      ...(clearRejection ? { rejection: null } : {}),
      controlRejection: null,
      error: null,
    });
    this.#inputSequence = Math.max(
      this.#inputSequence,
      snapshot.acknowledgedInputSequence,
    );
    if (!settlePending) return;
    for (const [commandId, pending] of this.#pending) {
      if (pending.sequence <= snapshot.acknowledgedInputSequence) {
        this.#pending.delete(commandId);
        pending.resolve();
      }
    }
  }

  #handleLifecycle(payload: unknown): void {
    const parsed = (
      this.#setupProtocol === SETUP_PROTOCOL_VERSION
        ? roomLifecycleStateV6Schema
        : roomLifecycleStateSchema
    ).safeParse(payload);
    if (!parsed.success || this.#state.room === null) {
      this.#failProtocol();
      return;
    }
    const lifecycle = parsed.data;
    const current = this.#state.roomLifecycle;
    const lifecycleRoundNumber = lifecycle.currentRound?.roundNumber ?? 0;
    const currentRoundNumber = current?.currentRound?.roundNumber ?? 0;
    if (lifecycleRoundNumber < currentRoundNumber) return;
    if (current !== null && lifecycle.isOwner !== current.isOwner) {
      this.#failProtocol();
      return;
    }
    const room = this.#state.room;
    if (room !== null && lifecycle.players !== undefined) {
      const playerSlots = lifecycle.players.map((player) => player.slotId);
      if (
        new Set(playerSlots).size !== playerSlots.length ||
        !playerSlots.includes(room.playerSlotId) ||
        playerSlots.length !== 2 ||
        lifecycle.players.some(
          (player) => player.occupied === false && player.online,
        )
      ) {
        this.#failProtocol();
        return;
      }
    }
    if (
      lifecycle.nextRound !== null &&
      (("requiredPlayerCount" in lifecycle.nextRound &&
        lifecycle.nextRound.requiredPlayerCount !== 2) ||
        ("readiness" in lifecycle.nextRound &&
          (lifecycle.nextRound.readiness.requiredSlotIds.length > 2 ||
            lifecycle.nextRound.readiness.requiredSlotIds.some(
              (slotId) =>
                !lifecycle.players?.some(
                  (player) => player.slotId === slotId && player.occupied,
                ),
            ))))
    ) {
      this.#failProtocol();
      return;
    }
    if (
      current?.currentRound !== null &&
      current?.currentRound !== undefined &&
      lifecycle.currentRound !== null &&
      lifecycle.currentRound.roundNumber === current.currentRound.roundNumber &&
      lifecycle.currentRound.status !== current.currentRound.status &&
      current.currentRound.status !== "active"
    ) {
      this.#failProtocol();
      return;
    }
    if (lifecycle.causedByCommandId !== undefined) {
      const pending = this.#pendingControls.get(lifecycle.causedByCommandId);
      if (pending !== undefined) {
        this.#pendingControls.delete(lifecycle.causedByCommandId);
        pending.resolve();
      }
    }
    if (lifecycle.closed) {
      this.#closing = true;
      this.#generation += 1;
      const room = this.#transportRoom;
      this.#transportRoom = null;
      this.#target = null;
      this.#expectedGameId = null;
      this.#rejectPending("The realtime room was closed.");
      if (room !== null) void room.leave(false).catch(() => 0);
      this.#replace({
        ...this.#state,
        connectionState: "closed",
        room: null,
        roomLifecycle: lifecycle,
        snapshot: null,
        previousSnapshot: null,
        error: null,
      });
      return;
    }
    const roundChanged = lifecycleRoundNumber > currentRoundNumber;
    if (roundChanged) {
      this.#inputSequence = 0;
      this.#usedCommandIds.clear();
    }
    this.#replace({
      ...this.#state,
      roomLifecycle: lifecycle,
      ...(roundChanged
        ? { snapshot: null, previousSnapshot: null, rejection: null }
        : {}),
      error: null,
    });
  }

  #handleServerMessage(payload: unknown): void {
    const connected = (
      this.#setupProtocol === SETUP_PROTOCOL_VERSION
        ? roomConnectedV6Schema
        : roomConnectedSchema
    ).safeParse(payload);
    if (connected.success) {
      if (
        connected.data.gameId !== this.#expectedGameId ||
        (this.#target !== null &&
          connected.data.roomCode !== this.#target.roomCode)
      ) {
        this.#failProtocol();
        return;
      }
      this.#target = {
        gameId: connected.data.gameId,
        roomCode: connected.data.roomCode,
        setupProtocol: this.#setupProtocol,
      };
      this.#replace({
        ...this.#state,
        connectionState: "connected",
        room: connected.data,
        controlRejection: null,
        error: null,
      });
      return;
    }
    const rejected = (
      this.#setupProtocol === SETUP_PROTOCOL_VERSION
        ? commandRejectedV6Schema
        : commandRejectedSchema
    ).safeParse(payload);
    if (!rejected.success) {
      this.#failProtocol();
      return;
    }
    const value = rejected.data as AnyCommandRejected;
    this.#replace({ ...this.#state, controlRejection: value, error: null });
    if (value.commandId !== undefined) {
      const pending = this.#pendingControls.get(value.commandId);
      if (pending !== undefined) {
        this.#pendingControls.delete(value.commandId);
        pending.reject(
          new Error(`Realtime room control was rejected with ${value.code}.`),
        );
      }
    }
  }

  #sendControl(
    input:
      | {
          readonly operation: "SELECT_STARTER";
          readonly starter: StarterChoice;
        }
      | {
          readonly operation:
            | "READY_FOR_ROUND"
            | "CANCEL_ROUND_READY"
            | "START_REMATCH"
            | "CLOSE_ROOM";
        },
  ): Promise<void> {
    const room = this.#transportRoom;
    if (room === null || this.#state.connectionState !== "connected") {
      return Promise.reject(new Error("The room is not connected."));
    }
    const commandId = this.#options.commandIds.createCommandId();
    if (this.#usedCommandIds.has(commandId)) {
      return Promise.reject(new Error("Duplicate command id."));
    }
    if (
      this.#setupProtocol === SETUP_PROTOCOL_VERSION &&
      input.operation !== "READY_FOR_ROUND" &&
      input.operation !== "CANCEL_ROUND_READY" &&
      input.operation !== "CLOSE_ROOM"
    ) {
      return Promise.reject(
        new Error("This room control is unavailable in protocol version 6."),
      );
    }
    const command = (
      this.#setupProtocol === SETUP_PROTOCOL_VERSION
        ? roomControlCommandV6Schema
        : roomControlCommandSchema
    ).parse({
      type: "room.control",
      protocolVersion: this.#setupProtocol,
      commandId,
      ...input,
    }) satisfies RoomControlCommand | RoomControlCommandV6;
    this.#usedCommandIds.add(commandId);
    return new Promise<void>((resolve, reject) => {
      this.#pendingControls.set(commandId, { resolve, reject });
      try {
        room.send(ROOM_CONTROL_MESSAGE, command);
      } catch {
        this.#pendingControls.delete(commandId);
        reject(new Error("Realtime room control could not be sent."));
      }
    });
  }

  async #reconnect(): Promise<void> {
    const target = this.#target;
    if (target === null) {
      this.#fail("CONNECTION_CLOSED");
      return;
    }
    const generation = ++this.#generation;
    const setupProtocol = target.setupProtocol;
    const deadline =
      this.#options.nowMilliseconds() +
      this.#options.reconnectWindowMilliseconds;
    this.#replace({
      ...this.#state,
      connectionState: "reconnecting",
      rejection: null,
      controlRejection: null,
      error: null,
    });
    let delayMilliseconds = 100;
    while (
      generation === this.#generation &&
      !this.#closing &&
      this.#options.nowMilliseconds() <= deadline
    ) {
      try {
        const ticket = gameServerTicketSchema.parse(
          await this.#options.ticketProvider(setupProtocol),
        );
        const client = this.#options.transport.createClient(
          this.#options.gameServerUrl,
        );
        const room = await client.join(
          REALTIME_GAME_ROOM_NAME,
          (setupProtocol === SETUP_PROTOCOL_VERSION
            ? joinGameRoomRequestV6Schema
            : joinGameRoomRequestSchema
          ).parse({
            type: "room.join",
            protocolVersion: setupProtocol,
            ticket,
            roomCode: target.roomCode,
          }),
        );
        if (generation !== this.#generation || this.#closing) {
          await room.leave(false).catch(() => 0);
          return;
        }
        this.#bind(room, generation);
        return;
      } catch {
        if (this.#options.nowMilliseconds() >= deadline) break;
        await this.#options.delay(delayMilliseconds);
        delayMilliseconds = Math.min(delayMilliseconds * 2, 2_000);
      }
    }
    if (generation === this.#generation) {
      this.#fail("CONNECTION_CLOSED");
    }
  }

  #failProtocol(): void {
    const room = this.#transportRoom;
    this.#transportRoom = null;
    this.#closing = true;
    this.#generation += 1;
    if (room !== null) void room.leave(false).catch(() => undefined);
    this.#rejectPending("The Game Server sent an invalid realtime message.");
    this.#replace({
      ...this.#state,
      connectionState: "closed",
      error: "INVALID_SERVER_MESSAGE",
    });
  }

  #fail(error: "TICKET_ERROR" | "ROOM_ERROR" | "CONNECTION_CLOSED"): void {
    this.#rejectPending("The realtime connection was closed.");
    this.#replace({ ...this.#state, connectionState: "closed", error });
  }

  #rejectPending(message: string): void {
    for (const pending of this.#pending.values())
      pending.reject(new Error(message));
    this.#pending.clear();
    for (const pending of this.#pendingControls.values())
      pending.reject(new Error(message));
    this.#pendingControls.clear();
  }

  #replace(state: RealtimeGameClientHostState<View, Outcome>): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}
