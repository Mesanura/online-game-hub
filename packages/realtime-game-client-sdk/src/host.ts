import { Client as ColyseusClient } from "@colyseus/sdk";
import {
  GAME_ROOM_NAME,
  PROTOCOL_VERSION,
  REALTIME_INPUT_MESSAGE,
  REALTIME_PROTOCOL_VERSION,
  REALTIME_SERVER_MESSAGE,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  createGameRoomRequestSchema,
  gameServerTicketSchema,
  joinGameRoomRequestSchema,
  realtimeInputCommandSchema,
  realtimeRejectedSchema,
  realtimeSnapshotSchema,
  roomCodeSchema,
  roomConnectedSchema,
  roomControlCommandSchema,
  roomLifecycleStateSchema,
} from "@online-game-hub/protocol";
import type {
  RealtimeRejected,
  RealtimeSnapshot,
  RoomConnected,
  RoomLifecycleState,
  StarterChoice,
} from "@online-game-hub/protocol";

import type { RealtimeClientConnectionState } from "./contracts.js";

export type RealtimeTicketProvider = () => Promise<string>;

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
  readonly room: RoomConnected | null;
  readonly roomLifecycle: RoomLifecycleState | null;
  readonly previousSnapshot: RealtimeSnapshot<View, Outcome> | null;
  readonly snapshot: RealtimeSnapshot<View, Outcome> | null;
  readonly rejection: RealtimeRejected | null;
  readonly error:
    "TICKET_ERROR" | "ROOM_ERROR" | "INVALID_SERVER_MESSAGE" | null;
}

export interface RealtimeGameClientHostOptions {
  readonly gameServerUrl: string;
  readonly ticketProvider: RealtimeTicketProvider;
  readonly transport?: RealtimeTransportFactory;
  readonly commandIds?: RealtimeCommandIdSource;
}

interface PendingInput {
  readonly sequence: number;
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
    Pick<RealtimeGameClientHostOptions, "transport" | "commandIds">
  > &
    Pick<RealtimeGameClientHostOptions, "gameServerUrl" | "ticketProvider">;
  readonly #listeners = new Set<() => void>();
  readonly #pending = new Map<string, PendingInput>();
  #state: RealtimeGameClientHostState<View, Outcome> = {
    connectionState: "idle",
    room: null,
    roomLifecycle: null,
    previousSnapshot: null,
    snapshot: null,
    rejection: null,
    error: null,
  };
  #transportRoom: RealtimeTransportRoom | null = null;
  #expectedGameId: string | null = null;
  #inputSequence = 0;
  #closing = false;

  public constructor(options: RealtimeGameClientHostOptions) {
    if (options.gameServerUrl.length === 0)
      throw new TypeError("Game Server URL is required.");
    this.#options = {
      gameServerUrl: options.gameServerUrl,
      ticketProvider: options.ticketProvider,
      transport: options.transport ?? colyseusRealtimeTransportFactory,
      commandIds: options.commandIds ?? secureRealtimeCommandIdSource,
    };
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
    this.#expectedGameId = gameId;
    await this.#connect((ticket, client) =>
      client.create(
        GAME_ROOM_NAME,
        createGameRoomRequestSchema.parse({
          type: "room.create",
          protocolVersion: PROTOCOL_VERSION,
          ticket,
          gameId,
          initialConfig,
        }),
      ),
    );
  }

  public async joinRoom(gameId: string, roomCode: string): Promise<void> {
    this.#expectedGameId = gameId;
    const canonicalCode = roomCodeSchema.parse(roomCode.trim().toUpperCase());
    await this.#connect((ticket, client) =>
      client.join(
        GAME_ROOM_NAME,
        joinGameRoomRequestSchema.parse({
          type: "room.join",
          protocolVersion: PROTOCOL_VERSION,
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
    const inputSequence = this.#inputSequence + 1;
    const command = realtimeInputCommandSchema.parse({
      type: "realtime.input",
      realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
      commandId,
      roundNumber: activeRound.roundNumber,
      inputSequence,
      input,
    });
    if (this.#pending.has(commandId))
      return Promise.reject(new Error("Duplicate command id."));
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

  public selectStarter(starter: StarterChoice): void {
    this.#sendControl({ operation: "SELECT_STARTER", starter });
  }

  public readyForRound(): void {
    this.#sendControl({ operation: "READY_FOR_ROUND" });
  }

  public cancelRoundReady(): void {
    this.#sendControl({ operation: "CANCEL_ROUND_READY" });
  }

  public startRematch(): void {
    this.#sendControl({ operation: "START_REMATCH" });
  }

  public closeRoom(): void {
    this.#sendControl({ operation: "CLOSE_ROOM" });
  }

  public async leaveRoom(): Promise<void> {
    this.#closing = true;
    const room = this.#transportRoom;
    this.#transportRoom = null;
    this.#inputSequence = 0;
    this.#rejectPending("The realtime room was left.");
    this.#replace({
      connectionState: "idle",
      room: null,
      roomLifecycle: null,
      previousSnapshot: null,
      snapshot: null,
      rejection: null,
      error: null,
    });
    if (room !== null) await room.leave(true).catch(() => 0);
  }

  public async close(): Promise<void> {
    this.#closing = true;
    const room = this.#transportRoom;
    this.#transportRoom = null;
    this.#rejectPending("The realtime connection was closed.");
    this.#replace({ ...this.#state, connectionState: "closed" });
    if (room !== null) await room.leave(false).catch(() => 0);
  }

  async #connect(
    reserve: (
      ticket: string,
      client: RealtimeTransportClient,
    ) => Promise<RealtimeTransportRoom>,
  ): Promise<void> {
    this.#closing = false;
    this.#replace({ ...this.#state, connectionState: "loading", error: null });
    let ticket: string;
    try {
      ticket = gameServerTicketSchema.parse(
        await this.#options.ticketProvider(),
      );
    } catch {
      this.#replace({
        ...this.#state,
        connectionState: "closed",
        error: "TICKET_ERROR",
      });
      return;
    }
    try {
      this.#replace({ ...this.#state, connectionState: "connecting" });
      const room = await reserve(
        ticket,
        this.#options.transport.createClient(this.#options.gameServerUrl),
      );
      this.#bind(room);
    } catch {
      this.#replace({
        ...this.#state,
        connectionState: "closed",
        error: "ROOM_ERROR",
      });
    }
  }

  #bind(room: RealtimeTransportRoom): void {
    this.#transportRoom = room;
    room.onMessage<unknown>(SERVER_PROTOCOL_MESSAGE, (payload) => {
      const parsed = roomConnectedSchema.safeParse(payload);
      if (!parsed.success || parsed.data.gameId !== this.#expectedGameId) {
        this.#failProtocol();
        return;
      }
      this.#replace({
        ...this.#state,
        connectionState: "connected",
        room: parsed.data,
        error: null,
      });
    });
    room.onMessage<unknown>(ROOM_CONTROL_MESSAGE, (payload) => {
      const parsed = roomLifecycleStateSchema.safeParse(payload);
      if (!parsed.success) {
        this.#failProtocol();
        return;
      }
      const currentRound = this.#state.roomLifecycle?.currentRound;
      const nextRound = parsed.data.currentRound;
      if (
        currentRound !== null &&
        currentRound !== undefined &&
        nextRound !== null &&
        nextRound.roundNumber < currentRound.roundNumber
      ) {
        return;
      }
      this.#replace({
        ...this.#state,
        roomLifecycle: parsed.data,
        error: null,
      });
    });
    room.onMessage<unknown>(REALTIME_SERVER_MESSAGE, (payload) => {
      const snapshot = realtimeSnapshotSchema.safeParse(payload);
      if (snapshot.success) {
        this.#handleSnapshot(snapshot.data as RealtimeSnapshot<View, Outcome>);
        return;
      }
      const rejection = realtimeRejectedSchema.safeParse(payload);
      if (!rejection.success) {
        this.#failProtocol();
        return;
      }
      const value = rejection.data as RealtimeRejected;
      this.#replace({ ...this.#state, rejection: value, error: null });
      if (value.commandId !== undefined) {
        const pending = this.#pending.get(value.commandId);
        if (pending !== undefined) {
          this.#pending.delete(value.commandId);
          pending.reject(new RealtimeCommandRejectedError(value));
        }
      }
    });
    room.onLeave(() => {
      if (this.#closing || this.#transportRoom !== room) return;
      this.#transportRoom = null;
      this.#rejectPending("The realtime connection closed.");
      this.#replace({ ...this.#state, connectionState: "reconnecting" });
    });
  }

  #handleSnapshot(snapshot: RealtimeSnapshot<View, Outcome>): void {
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
    this.#replace({
      ...this.#state,
      previousSnapshot: current,
      snapshot,
      rejection: null,
      error: null,
    });
    for (const [commandId, pending] of this.#pending) {
      if (pending.sequence <= snapshot.acknowledgedInputSequence) {
        this.#pending.delete(commandId);
        pending.resolve();
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
  ): void {
    if (this.#transportRoom === null)
      throw new Error("The room is not connected.");
    this.#transportRoom.send(
      ROOM_CONTROL_MESSAGE,
      roomControlCommandSchema.parse({
        type: "room.control",
        protocolVersion: PROTOCOL_VERSION,
        commandId: this.#options.commandIds.createCommandId(),
        ...input,
      }),
    );
  }

  #failProtocol(): void {
    const room = this.#transportRoom;
    this.#transportRoom = null;
    this.#closing = true;
    if (room !== null) void room.leave(false).catch(() => undefined);
    this.#rejectPending("The Game Server sent an invalid realtime message.");
    this.#replace({
      ...this.#state,
      connectionState: "closed",
      error: "INVALID_SERVER_MESSAGE",
    });
  }

  #rejectPending(message: string): void {
    for (const pending of this.#pending.values())
      pending.reject(new Error(message));
    this.#pending.clear();
  }

  #replace(state: RealtimeGameClientHostState<View, Outcome>): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}
