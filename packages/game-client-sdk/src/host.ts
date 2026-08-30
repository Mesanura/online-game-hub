import { Client as ColyseusClient } from "@colyseus/sdk";
import {
  GAME_ACTION_MESSAGE,
  GAME_ROOM_NAME,
  PROTOCOL_VERSION,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  createGameRoomRequestSchema,
  gameActionCommandSchema,
  gameServerTicketSchema,
  joinGameRoomRequestSchema,
  roomControlCommandSchema,
  roomLifecycleStateSchema,
  roomCodeSchema,
  serverMessageSchema,
} from "@online-game-hub/protocol";
import type {
  CommandRejected,
  GameActionCommand,
  MatchSnapshot,
  RoomControlCommand,
  RoomControlOperation,
  RoomConnected,
  RoomLifecycleState,
} from "@online-game-hub/protocol";

import type { ClientConnectionState } from "./contracts.js";
import type { GameServerTicketProvider } from "./ticket-provider.js";

export interface GameTransportRoom {
  onMessage<Payload>(
    type: string | number,
    callback: (payload: Payload) => void,
  ): () => void;
  onLeave(callback: (code: number, reason?: string) => void): unknown;
  send<Payload>(type: string | number, payload: Payload): void;
  leave(consented?: boolean): Promise<number>;
}

export interface GameTransportClient {
  create(roomName: string, options: unknown): Promise<GameTransportRoom>;
  join(roomName: string, options: unknown): Promise<GameTransportRoom>;
}

export interface GameTransportFactory {
  createClient(endpoint: string): GameTransportClient;
}

export const colyseusGameTransportFactory: GameTransportFactory = {
  createClient(endpoint) {
    return new ColyseusClient(endpoint) as GameTransportClient;
  },
};

export interface CommandIdSource {
  createCommandId(): string;
}

export const secureCommandIdSource: CommandIdSource = {
  createCommandId: () => globalThis.crypto.randomUUID(),
};

export type GameClientHostErrorCode =
  | "TICKET_ERROR"
  | "ROOM_ERROR"
  | "INVALID_SERVER_MESSAGE"
  | "CONNECTION_CLOSED";

export interface GameClientHostError {
  readonly code: GameClientHostErrorCode;
  readonly message: string;
}

export interface GameClientHostState<View = unknown, Outcome = unknown> {
  readonly connectionState: ClientConnectionState;
  readonly room: RoomConnected | null;
  readonly snapshot: MatchSnapshot<View, Outcome> | null;
  readonly roomLifecycle: RoomLifecycleState | null;
  readonly rejection: CommandRejected | null;
  readonly error: GameClientHostError | null;
}

export interface GameClientHostOptions {
  readonly gameServerUrl: string;
  readonly ticketProvider: GameServerTicketProvider;
  readonly transport?: GameTransportFactory;
  readonly commandIds?: CommandIdSource;
  readonly reconnectWindowMilliseconds?: number;
  readonly nowMilliseconds?: () => number;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

interface RoomTarget {
  readonly gameId: string;
  readonly roomCode: string;
}

interface PendingCommand {
  readonly kind: "action" | "control";
  readonly expectedRoundNumber?: number;
  readonly expectedRevision?: number;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

export class CommandRejectedError extends Error {
  public constructor(public readonly rejection: CommandRejected) {
    super(`Game command was rejected with ${rejection.code}.`);
    this.name = "CommandRejectedError";
  }
}

const defaultDelay = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class GameClientHost<View = unknown, Outcome = unknown> {
  readonly #options: Required<
    Pick<
      GameClientHostOptions,
      | "transport"
      | "commandIds"
      | "reconnectWindowMilliseconds"
      | "nowMilliseconds"
      | "delay"
    >
  > &
    Pick<GameClientHostOptions, "gameServerUrl" | "ticketProvider">;
  readonly #listeners = new Set<() => void>();
  readonly #pendingCommands = new Map<string, PendingCommand>();
  #state: GameClientHostState<View, Outcome> = {
    connectionState: "idle",
    room: null,
    snapshot: null,
    roomLifecycle: null,
    rejection: null,
    error: null,
  };
  #transportRoom: GameTransportRoom | null = null;
  #target: RoomTarget | null = null;
  #expectedGameId: string | null = null;
  #generation = 0;
  #closing = false;

  public constructor(options: GameClientHostOptions) {
    if (options.gameServerUrl.length === 0) {
      throw new TypeError("Game Server public URL is required.");
    }
    const reconnectWindowMilliseconds =
      options.reconnectWindowMilliseconds ?? 60_000;
    if (
      !Number.isSafeInteger(reconnectWindowMilliseconds) ||
      reconnectWindowMilliseconds < 0
    ) {
      throw new RangeError(
        "Reconnect window must be a non-negative integer in milliseconds.",
      );
    }
    this.#options = {
      gameServerUrl: options.gameServerUrl,
      ticketProvider: options.ticketProvider,
      transport: options.transport ?? colyseusGameTransportFactory,
      commandIds: options.commandIds ?? secureCommandIdSource,
      reconnectWindowMilliseconds,
      nowMilliseconds: options.nowMilliseconds ?? Date.now,
      delay: options.delay ?? defaultDelay,
    };
  }

  public getState(): GameClientHostState<View, Outcome> {
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
    this.#target = null;
    await this.#connect(async (ticket, client) =>
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
    const normalizedRoomCode = roomCode.trim().toUpperCase();
    const validatedRoomCode = roomCodeSchema.parse(normalizedRoomCode);
    this.#expectedGameId = gameId;
    this.#target = { gameId, roomCode: validatedRoomCode };
    await this.#connect(async (ticket, client) =>
      client.join(
        GAME_ROOM_NAME,
        joinGameRoomRequestSchema.parse({
          type: "room.join",
          protocolVersion: PROTOCOL_VERSION,
          ticket,
          roomCode: validatedRoomCode,
        }),
      ),
    );
  }

  public submitAction(action: unknown): Promise<void> {
    const room = this.#transportRoom;
    const snapshot = this.#state.snapshot;
    if (
      room === null ||
      this.#state.connectionState !== "connected" ||
      snapshot === null
    ) {
      return Promise.reject(new Error("The game room is not connected."));
    }
    const commandId = this.#options.commandIds.createCommandId();
    const roundNumber = this.#state.roomLifecycle?.roundNumber ?? 1;
    const command = gameActionCommandSchema.parse({
      type: "game.action",
      protocolVersion: PROTOCOL_VERSION,
      commandId,
      roundNumber,
      expectedRevision: snapshot.revision,
      action,
    }) satisfies GameActionCommand;
    if (this.#pendingCommands.has(commandId)) {
      return Promise.reject(
        new Error("Command id source produced a duplicate id."),
      );
    }

    return new Promise<void>((resolve, reject) => {
      this.#pendingCommands.set(commandId, {
        kind: "action",
        expectedRoundNumber: roundNumber,
        expectedRevision: snapshot.revision,
        resolve,
        reject,
      });
      try {
        room.send(GAME_ACTION_MESSAGE, command);
      } catch {
        this.#pendingCommands.delete(commandId);
        reject(new Error("The game command could not be sent."));
      }
    });
  }

  public requestRematch(): Promise<void> {
    return this.#sendControl("REQUEST_REMATCH");
  }

  public cancelRematch(): Promise<void> {
    return this.#sendControl("CANCEL_REMATCH");
  }

  public closeRoom(): Promise<void> {
    return this.#sendControl("CLOSE_ROOM");
  }

  public async leaveRoom(): Promise<void> {
    this.#closing = true;
    this.#generation += 1;
    const room = this.#transportRoom;
    this.#transportRoom = null;
    this.#target = null;
    this.#expectedGameId = null;
    this.#rejectPending("The game room was left.");
    this.#replaceState({
      connectionState: "idle",
      room: null,
      snapshot: null,
      roomLifecycle: null,
      rejection: null,
      error: null,
    });
    if (room !== null) {
      try {
        await room.leave(true);
      } catch {
        // The local identity has already left; transport shutdown is best-effort.
      }
    }
  }

  public async close(): Promise<void> {
    this.#closing = true;
    this.#generation += 1;
    const room = this.#transportRoom;
    this.#transportRoom = null;
    this.#rejectPending("The game connection was closed.");
    this.#replaceState({
      ...this.#state,
      connectionState: "closed",
      rejection: null,
      error: null,
    });
    if (room !== null) {
      try {
        await room.leave(false);
      } catch {
        // The local lifecycle is already closed; transport shutdown is best-effort.
      }
    }
  }

  #sendControl(operation: RoomControlOperation): Promise<void> {
    const room = this.#transportRoom;
    if (room === null || this.#state.connectionState !== "connected") {
      return Promise.reject(new Error("The game room is not connected."));
    }
    const commandId = this.#options.commandIds.createCommandId();
    const command = roomControlCommandSchema.parse({
      type: "room.control",
      protocolVersion: PROTOCOL_VERSION,
      commandId,
      operation,
    }) satisfies RoomControlCommand;
    if (this.#pendingCommands.has(commandId)) {
      return Promise.reject(
        new Error("Command id source produced a duplicate id."),
      );
    }
    return new Promise<void>((resolve, reject) => {
      this.#pendingCommands.set(commandId, {
        kind: "control",
        resolve,
        reject,
      });
      try {
        room.send(ROOM_CONTROL_MESSAGE, command);
      } catch {
        this.#pendingCommands.delete(commandId);
        reject(new Error("The room control command could not be sent."));
      }
    });
  }

  async #connect(
    reserve: (
      ticket: string,
      client: GameTransportClient,
    ) => Promise<GameTransportRoom>,
  ): Promise<void> {
    this.#closing = false;
    const generation = ++this.#generation;
    this.#replaceState({
      connectionState: "loading",
      room: null,
      snapshot: null,
      roomLifecycle: null,
      rejection: null,
      error: null,
    });
    let ticket: string;
    try {
      ticket = gameServerTicketSchema.parse(
        await this.#options.ticketProvider(),
      );
    } catch {
      this.#fail("TICKET_ERROR", "A Game Server ticket could not be obtained.");
      return;
    }
    if (generation !== this.#generation) {
      return;
    }
    this.#replaceState({ ...this.#state, connectionState: "connecting" });
    try {
      const client = this.#options.transport.createClient(
        this.#options.gameServerUrl,
      );
      const room = await reserve(ticket, client);
      if (generation !== this.#generation) {
        await room.leave(false);
        return;
      }
      this.#bindRoom(room, generation);
    } catch {
      if (generation === this.#generation) {
        this.#fail("ROOM_ERROR", "The game room could not be opened.");
      }
    }
  }

  #bindRoom(room: GameTransportRoom, generation: number): void {
    this.#transportRoom = room;
    room.onMessage<unknown>(SERVER_PROTOCOL_MESSAGE, (payload) => {
      if (generation === this.#generation) {
        this.#handleServerMessage(payload);
      }
    });
    room.onMessage<unknown>(ROOM_CONTROL_MESSAGE, (payload) => {
      if (generation === this.#generation) {
        this.#handleLifecycle(payload);
      }
    });
    room.onLeave(() => {
      if (
        generation !== this.#generation ||
        this.#closing ||
        this.#transportRoom !== room
      ) {
        return;
      }
      this.#transportRoom = null;
      if (this.#state.roomLifecycle?.closed === true) {
        return;
      }
      void this.#reconnect();
    });
  }

  #handleLifecycle(payload: unknown): void {
    const parsed = roomLifecycleStateSchema.safeParse(payload);
    if (!parsed.success || this.#state.room === null) {
      this.#failProtocol();
      return;
    }
    const lifecycle = parsed.data;
    const current = this.#state.roomLifecycle;
    if (current !== null && lifecycle.roundNumber < current.roundNumber) {
      return;
    }
    if (current !== null && lifecycle.isOwner !== current.isOwner) {
      this.#failProtocol();
      return;
    }
    const roundChanged =
      current !== null && lifecycle.roundNumber > current.roundNumber;
    const causedByCommandId = lifecycle.causedByCommandId;
    if (causedByCommandId !== undefined) {
      const pending = this.#pendingCommands.get(causedByCommandId);
      if (pending?.kind === "control") {
        this.#pendingCommands.delete(causedByCommandId);
        pending.resolve();
      }
    }
    if (lifecycle.closed) {
      this.#closing = true;
      this.#generation += 1;
      this.#transportRoom = null;
      this.#target = null;
      this.#expectedGameId = null;
      this.#rejectPending("The live game room was closed.");
      this.#replaceState({
        connectionState: "idle",
        room: null,
        snapshot: null,
        roomLifecycle: lifecycle,
        rejection: null,
        error: null,
      });
      return;
    }
    this.#replaceState({
      ...this.#state,
      roomLifecycle: lifecycle,
      ...(roundChanged ? { snapshot: null, rejection: null } : {}),
      error: null,
    });
  }

  #handleServerMessage(payload: unknown): void {
    const parsed = serverMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.#failProtocol();
      return;
    }
    const message = parsed.data;
    if (message.type === "room.connected") {
      if (
        message.gameId !== this.#expectedGameId ||
        (this.#target !== null && message.roomCode !== this.#target.roomCode)
      ) {
        this.#failProtocol();
        return;
      }
      this.#target = { gameId: message.gameId, roomCode: message.roomCode };
      this.#replaceState({
        ...this.#state,
        connectionState: "connected",
        room: message,
        rejection: null,
        error: null,
      });
      return;
    }
    if (message.type === "match.snapshot") {
      this.#applySnapshot(message as MatchSnapshot<View, Outcome>);
      return;
    }

    const rejection: CommandRejected = {
      type: message.type,
      protocolVersion: message.protocolVersion,
      code: message.code,
      retryable: message.retryable,
      ...(message.commandId === undefined
        ? {}
        : { commandId: message.commandId }),
      ...(message.revision === undefined ? {} : { revision: message.revision }),
      ...(message.gameRuleCode === undefined
        ? {}
        : { gameRuleCode: message.gameRuleCode }),
      ...(message.snapshot === undefined
        ? {}
        : { snapshot: message.snapshot as MatchSnapshot }),
    };
    if (rejection.snapshot !== undefined) {
      this.#applySnapshot(
        rejection.snapshot as MatchSnapshot<View, Outcome>,
        false,
        false,
      );
    }
    this.#replaceState({
      ...this.#state,
      rejection,
      error: null,
    });
    if (rejection.commandId !== undefined) {
      const pending = this.#pendingCommands.get(rejection.commandId);
      if (pending !== undefined) {
        this.#pendingCommands.delete(rejection.commandId);
        pending.reject(new CommandRejectedError(rejection));
      }
    }
  }

  #applySnapshot(
    snapshot: MatchSnapshot<View, Outcome>,
    clearRejection = true,
    settlePending = true,
  ): void {
    const room = this.#state.room;
    if (
      snapshot.gameId !== this.#expectedGameId ||
      (room !== null &&
        (snapshot.gameId !== room.gameId ||
          snapshot.gameVersion !== room.gameVersion ||
          (snapshot.viewer.kind === "player" &&
            snapshot.viewer.slotId !== room.playerSlotId)))
    ) {
      this.#failProtocol();
      return;
    }
    const current = this.#state.snapshot;
    const snapshotRoundNumber = snapshot.roundNumber ?? 1;
    const lifecycleRoundNumber = this.#state.roomLifecycle?.roundNumber;
    if (
      lifecycleRoundNumber !== undefined &&
      snapshotRoundNumber < lifecycleRoundNumber
    ) {
      return;
    }
    if (
      lifecycleRoundNumber !== undefined &&
      snapshotRoundNumber > lifecycleRoundNumber
    ) {
      this.#failProtocol();
      return;
    }
    if (
      current !== null &&
      (current.roundNumber ?? 1) === snapshotRoundNumber &&
      snapshot.revision < current.revision
    ) {
      return;
    }
    this.#replaceState({
      ...this.#state,
      snapshot,
      ...(clearRejection ? { rejection: null } : {}),
      error: null,
    });
    if (!settlePending) {
      return;
    }
    for (const [commandId, pending] of this.#pendingCommands) {
      if (
        pending.kind === "action" &&
        pending.expectedRoundNumber === snapshotRoundNumber &&
        (snapshot.causedByCommandId === commandId ||
          (pending.expectedRevision !== undefined &&
            snapshot.revision > pending.expectedRevision))
      ) {
        this.#pendingCommands.delete(commandId);
        pending.resolve();
      }
    }
  }

  async #reconnect(): Promise<void> {
    const target = this.#target;
    if (target === null) {
      this.#fail("CONNECTION_CLOSED", "The game connection closed.");
      return;
    }
    const generation = ++this.#generation;
    const deadline =
      this.#options.nowMilliseconds() +
      this.#options.reconnectWindowMilliseconds;
    this.#replaceState({
      ...this.#state,
      connectionState: "reconnecting",
      rejection: null,
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
          await this.#options.ticketProvider(),
        );
        const client = this.#options.transport.createClient(
          this.#options.gameServerUrl,
        );
        const room = await client.join(
          GAME_ROOM_NAME,
          joinGameRoomRequestSchema.parse({
            type: "room.join",
            protocolVersion: PROTOCOL_VERSION,
            ticket,
            roomCode: target.roomCode,
          }),
        );
        if (generation !== this.#generation || this.#closing) {
          await room.leave(false);
          return;
        }
        this.#bindRoom(room, generation);
        return;
      } catch {
        if (this.#options.nowMilliseconds() >= deadline) {
          break;
        }
        await this.#options.delay(delayMilliseconds);
        delayMilliseconds = Math.min(delayMilliseconds * 2, 2_000);
      }
    }
    if (generation === this.#generation) {
      this.#fail(
        "CONNECTION_CLOSED",
        "The game connection could not be restored.",
      );
    }
  }

  #failProtocol(): void {
    const room = this.#transportRoom;
    this.#transportRoom = null;
    this.#closing = true;
    this.#generation += 1;
    if (room !== null) {
      void room.leave(false).catch(() => undefined);
    }
    this.#fail(
      "INVALID_SERVER_MESSAGE",
      "The Game Server sent an invalid protocol message.",
    );
  }

  #fail(code: GameClientHostErrorCode, message: string): void {
    this.#rejectPending(message);
    this.#replaceState({
      ...this.#state,
      connectionState: "closed",
      rejection: null,
      error: { code, message },
    });
  }

  #rejectPending(message: string): void {
    for (const pending of this.#pendingCommands.values()) {
      pending.reject(new Error(message));
    }
    this.#pendingCommands.clear();
  }

  #replaceState(state: GameClientHostState<View, Outcome>): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
