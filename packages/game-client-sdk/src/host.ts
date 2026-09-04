import { Client as ColyseusClient } from "@colyseus/sdk";
import {
  GAME_ACTION_MESSAGE,
  GAME_ROOM_NAME,
  GAME_SETUP_MESSAGE,
  PROTOCOL_VERSION,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  SETUP_PROTOCOL_VERSION,
  createGameRoomRequestSchema,
  createGameRoomRequestV6Schema,
  gameActionCommandSchema,
  gameActionCommandV6Schema,
  gameSetupCommandSchema,
  gameServerTicketSchema,
  joinGameRoomRequestSchema,
  joinGameRoomRequestV6Schema,
  roomControlCommandSchema,
  roomControlCommandV6Schema,
  roomLifecycleStateSchema,
  roomLifecycleStateV6Schema,
  roomCodeSchema,
  serverMessageSchema,
  serverMessageV6Schema,
} from "@online-game-hub/protocol";
import type {
  CommandRejected,
  CommandRejectedV6,
  GameActionCommand,
  GameActionCommandV6,
  GameSetupCommand,
  MatchSnapshot,
  MatchSnapshotV6,
  RoomControlCommand,
  RoomControlCommandV6,
  RoomConnected,
  RoomConnectedV6,
  RoomLifecycleState,
  RoomLifecycleStateV6,
  StarterChoice,
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

export type GameSetupProtocol =
  typeof PROTOCOL_VERSION | typeof SETUP_PROTOCOL_VERSION;

type AnyRoomConnected = RoomConnected | RoomConnectedV6;
type AnyMatchSnapshot<View, Outcome> =
  MatchSnapshot<View, Outcome> | MatchSnapshotV6<View, Outcome>;
type AnyRoomLifecycle = RoomLifecycleState | RoomLifecycleStateV6;
type AnyCommandRejected = CommandRejected | CommandRejectedV6;

export interface GameClientHostState<View = unknown, Outcome = unknown> {
  readonly connectionState: ClientConnectionState;
  readonly room: AnyRoomConnected | null;
  readonly snapshot: AnyMatchSnapshot<View, Outcome> | null;
  readonly roomLifecycle: AnyRoomLifecycle | null;
  readonly rejection: AnyCommandRejected | null;
  readonly error: GameClientHostError | null;
}

export interface GameClientHostOptions {
  readonly gameServerUrl: string;
  readonly ticketProvider: GameServerTicketProvider;
  readonly setupProtocol?: GameSetupProtocol;
  readonly transport?: GameTransportFactory;
  readonly commandIds?: CommandIdSource;
  readonly reconnectWindowMilliseconds?: number;
  readonly nowMilliseconds?: () => number;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

interface RoomTarget {
  readonly gameId: string;
  readonly roomCode: string;
  readonly setupProtocol: GameSetupProtocol;
}

interface PendingCommand {
  readonly kind: "action" | "control" | "setup";
  readonly expectedRoundNumber?: number;
  readonly expectedRevision?: number;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

type RoomControlInput =
  | {
      readonly operation: "SELECT_STARTER";
      readonly starter: StarterChoice;
    }
  | {
      readonly operation: "SELECT_PLAYER_COUNT";
      readonly playerCount: number;
    }
  | {
      readonly operation: "SELECT_PLAYER_ASSIGNMENT";
      readonly assignment: string;
    }
  | {
      readonly operation:
        | "CLEAR_PLAYER_ASSIGNMENT"
        | "READY_FOR_ROUND"
        | "CANCEL_ROUND_READY"
        | "START_REMATCH"
        | "CLOSE_ROOM";
    };

export class CommandRejectedError extends Error {
  public constructor(public readonly rejection: AnyCommandRejected) {
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
  readonly #defaultSetupProtocol: GameSetupProtocol;
  #setupProtocol: GameSetupProtocol;
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
      transport: options.transport ?? colyseusGameTransportFactory,
      commandIds: options.commandIds ?? secureCommandIdSource,
      reconnectWindowMilliseconds,
      nowMilliseconds: options.nowMilliseconds ?? Date.now,
      delay: options.delay ?? defaultDelay,
    };
    this.#defaultSetupProtocol = setupProtocol;
    this.#setupProtocol = setupProtocol;
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
    const setupProtocol = this.#defaultSetupProtocol;
    this.#expectedGameId = gameId;
    this.#target = null;
    await this.#connect(setupProtocol, async (ticket, client) =>
      client.create(
        GAME_ROOM_NAME,
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
    const normalizedRoomCode = roomCode.trim().toUpperCase();
    const validatedRoomCode = roomCodeSchema.parse(normalizedRoomCode);
    this.#expectedGameId = gameId;
    this.#target = { gameId, roomCode: validatedRoomCode, setupProtocol };
    await this.#connect(setupProtocol, async (ticket, client) =>
      client.join(
        GAME_ROOM_NAME,
        (setupProtocol === SETUP_PROTOCOL_VERSION
          ? joinGameRoomRequestV6Schema
          : joinGameRoomRequestSchema
        ).parse({
          type: "room.join",
          protocolVersion: setupProtocol,
          ticket,
          roomCode: validatedRoomCode,
        }),
      ),
    );
  }

  public submitAction(action: unknown): Promise<void> {
    const room = this.#transportRoom;
    const snapshot = this.#state.snapshot;
    const currentRound = this.#state.roomLifecycle?.currentRound;
    if (
      room === null ||
      this.#state.connectionState !== "connected" ||
      snapshot === null ||
      currentRound?.status !== "active" ||
      snapshot.status !== "active" ||
      snapshot.roundNumber !== currentRound.roundNumber
    ) {
      return Promise.reject(new Error("The game round is not active."));
    }
    const commandId = this.#options.commandIds.createCommandId();
    const roundNumber = currentRound.roundNumber;
    const command = (
      this.#setupProtocol === SETUP_PROTOCOL_VERSION
        ? gameActionCommandV6Schema
        : gameActionCommandSchema
    ).parse({
      type: "game.action",
      protocolVersion: this.#setupProtocol,
      commandId,
      roundNumber,
      expectedRevision: snapshot.revision,
      action,
    }) satisfies GameActionCommand | GameActionCommandV6;
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

  public selectStarter(starter: StarterChoice): Promise<void> {
    if (this.#setupProtocol === SETUP_PROTOCOL_VERSION) {
      return this.submitSetup({ type: "SELECT_STARTER", starter });
    }
    return this.#sendControl({ operation: "SELECT_STARTER", starter });
  }

  public selectPlayerCount(playerCount: number): Promise<void> {
    if (this.#setupProtocol === SETUP_PROTOCOL_VERSION) {
      return this.submitSetup({ type: "SELECT_PLAYER_COUNT", playerCount });
    }
    return this.#sendControl({ operation: "SELECT_PLAYER_COUNT", playerCount });
  }

  public selectPlayerAssignment(assignment: string): Promise<void> {
    if (this.#setupProtocol === SETUP_PROTOCOL_VERSION) {
      return this.submitSetup({
        type: "SELECT_PLAYER_ASSIGNMENT",
        assignment,
      });
    }
    return this.#sendControl({
      operation: "SELECT_PLAYER_ASSIGNMENT",
      assignment,
    });
  }

  public clearPlayerAssignment(): Promise<void> {
    if (this.#setupProtocol === SETUP_PROTOCOL_VERSION) {
      return this.submitSetup({ type: "CLEAR_PLAYER_ASSIGNMENT" });
    }
    return this.#sendControl({ operation: "CLEAR_PLAYER_ASSIGNMENT" });
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
    if (this.#pendingCommands.has(commandId)) {
      return Promise.reject(
        new Error("Command id source produced a duplicate id."),
      );
    }
    const command = gameSetupCommandSchema.parse({
      type: "game.setup",
      protocolVersion: SETUP_PROTOCOL_VERSION,
      commandId,
      roundNumber: nextRound.roundNumber,
      expectedSetupRevision: nextRound.setupRevision,
      action,
    }) satisfies GameSetupCommand;
    return new Promise<void>((resolve, reject) => {
      this.#pendingCommands.set(commandId, {
        kind: "setup",
        resolve,
        reject,
      });
      try {
        room.send(GAME_SETUP_MESSAGE, command);
      } catch {
        this.#pendingCommands.delete(commandId);
        reject(new Error("The round setup command could not be sent."));
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

  #sendControl(input: RoomControlInput): Promise<void> {
    const room = this.#transportRoom;
    if (room === null || this.#state.connectionState !== "connected") {
      return Promise.reject(new Error("The game room is not connected."));
    }
    const commandId = this.#options.commandIds.createCommandId();
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
    setupProtocol: GameSetupProtocol,
    reserve: (
      ticket: string,
      client: GameTransportClient,
    ) => Promise<GameTransportRoom>,
  ): Promise<void> {
    this.#closing = false;
    const generation = ++this.#generation;
    this.#setupProtocol = setupProtocol;
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
        await this.#options.ticketProvider(setupProtocol),
      );
    } catch {
      if (generation === this.#generation) {
        this.#fail(
          "TICKET_ERROR",
          "A Game Server ticket could not be obtained.",
        );
      }
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
    if (current !== null && lifecycleRoundNumber < currentRoundNumber) {
      return;
    }
    if (current !== null && lifecycle.isOwner !== current.isOwner) {
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
    const roundChanged =
      current !== null && lifecycleRoundNumber > currentRoundNumber;
    const causedByCommandId = lifecycle.causedByCommandId;
    if (causedByCommandId !== undefined) {
      const pending = this.#pendingCommands.get(causedByCommandId);
      if (pending?.kind === "control" || pending?.kind === "setup") {
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
    const parsed = (
      this.#setupProtocol === SETUP_PROTOCOL_VERSION
        ? serverMessageV6Schema
        : serverMessageSchema
    ).safeParse(payload);
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
      this.#target = {
        gameId: message.gameId,
        roomCode: message.roomCode,
        setupProtocol: this.#setupProtocol,
      };
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
      this.#applySnapshot(message as AnyMatchSnapshot<View, Outcome>);
      return;
    }
    if (message.type !== "command.rejected") {
      this.#failProtocol();
      return;
    }

    const rejection = message as AnyCommandRejected;
    if (rejection.snapshot !== undefined) {
      this.#applySnapshot(
        rejection.snapshot as AnyMatchSnapshot<View, Outcome>,
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
    snapshot: AnyMatchSnapshot<View, Outcome>,
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
    const snapshotRoundNumber = snapshot.roundNumber;
    const lifecycleRound = this.#state.roomLifecycle?.currentRound;
    if (lifecycleRound === undefined || lifecycleRound === null) {
      this.#failProtocol();
      return;
    }
    const lifecycleRoundNumber = lifecycleRound.roundNumber;
    if (snapshotRoundNumber < lifecycleRoundNumber) {
      return;
    }
    if (snapshotRoundNumber > lifecycleRoundNumber) {
      this.#failProtocol();
      return;
    }
    if (snapshot.status !== lifecycleRound.status) {
      this.#failProtocol();
      return;
    }
    if (
      current !== null &&
      current.roundNumber === snapshotRoundNumber &&
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
    const setupProtocol = target.setupProtocol;
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
          await this.#options.ticketProvider(setupProtocol),
        );
        const client = this.#options.transport.createClient(
          this.#options.gameServerUrl,
        );
        const room = await client.join(
          GAME_ROOM_NAME,
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
