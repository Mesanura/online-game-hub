import { CloseCode, Room, ServerError } from "@colyseus/core";
import type { Client, RoomException, RoomMethodName } from "@colyseus/core";
import { REPLAY_FORMAT_VERSION, type ReplayStore } from "./replay.js";
import {
  RNG_ALGORITHM_V1,
  createRng,
  isJsonValue,
  nextInt,
} from "@online-game-hub/game-sdk";
import type {
  JsonValue,
  PlayerSlotId,
  RngState,
  UnknownGameDefinition,
} from "@online-game-hub/game-sdk";
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
  GAME_ACTION_MESSAGE,
  GAME_SETUP_MESSAGE,
  PROTOCOL_VERSION,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  SETUP_PROTOCOL_VERSION,
  createGameRoomRequestSchema,
  createGameRoomRequestV6Schema,
  gameActionCommandSchema,
  gameActionCommandV6Schema,
  gameRoomRequestV6Schema,
  gameRoomRequestSchema,
  gameSetupCommandSchema,
  roomControlCommandSchema,
  roomControlCommandV6Schema,
} from "@online-game-hub/protocol";
import type {
  CommandRejected,
  CommandRejectedV6,
  CreateGameRoomRequest,
  CreateGameRoomRequestV6,
  GameRoomRequest,
  GameRoomRequestV6,
  MatchSnapshot,
  MatchSnapshotV6,
  MatchStatus,
  ProtocolErrorCode,
  RoomCloseReason,
  RoomConnected,
  RoomConnectedV6,
  RoomControlCommandV6,
  RoomLifecycleState,
  RoomLifecycleStateV6,
  ServerMessage,
  ServerMessageV6,
  SetupProtocolGeneration,
  StarterChoice,
} from "@online-game-hub/protocol";

import type { TicketVerifier } from "./auth.js";
import type { CancelTimer, RuntimeClock } from "./clock.js";
import type { RuntimeIdSource } from "./ids.js";
import { secureRuntimeIdSource } from "./ids.js";
import { NoopMatchArchive } from "./match-archive.js";
import type { MatchArchive } from "./match-archive.js";
import {
  correlatePlayerSessionId,
  noopRuntimeLogger,
} from "./observability.js";
import type {
  MetricLabels,
  MetricsCollector,
  RuntimeLogger,
  RuntimeMetricName,
} from "./observability.js";
import { InMemoryMetricsCollector } from "./observability.js";
import type {
  RoomStore,
  StoredGameRound,
  StoredGameRoom,
  StoredPlayerSlot,
} from "./room-store.js";

export {
  GAME_ACTION_MESSAGE,
  GAME_SETUP_MESSAGE,
  GAME_ROOM_NAME,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
} from "@online-game-hub/protocol";
export const DEFAULT_RECONNECT_GRACE_MILLISECONDS = 60_000;
export const DEFAULT_TERMINAL_ROOM_TTL_MILLISECONDS = 300_000;

export type CurrentGameDefinitionResolver = (
  gameId: string,
) => UnknownGameDefinition | undefined;
export type ExactGameDefinitionResolver = (
  gameId: string,
  gameVersion: string,
) => UnknownGameDefinition | undefined;
export type ExactRoundSetupDefinitionResolver = (
  gameId: string,
  gameVersion: string,
) => UnknownRoundSetupDefinition | undefined;
export type SetupProtocolResolver = (
  gameId: string,
  gameVersion: string,
) => SetupProtocolGeneration | undefined;

export interface AuthoritativeGameRoomDependencies {
  readonly ticketVerifier: TicketVerifier;
  readonly resolveCurrentDefinition: CurrentGameDefinitionResolver;
  readonly resolveDefinition: ExactGameDefinitionResolver;
  readonly resolveRoundSetupDefinition: ExactRoundSetupDefinitionResolver;
  readonly resolveSetupProtocol: SetupProtocolResolver;
  readonly roomStore: RoomStore;
  readonly replayStore: ReplayStore;
  readonly matchArchive?: MatchArchive;
  readonly clock: RuntimeClock;
  readonly ids?: RuntimeIdSource;
  readonly metrics?: MetricsCollector;
  readonly logger?: RuntimeLogger;
  readonly reconnectGraceMilliseconds?: number;
  readonly terminalRoomTtlMilliseconds?: number;
}

export interface GameRoomMetadata {
  readonly roomCode: string;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly setupProtocol: SetupProtocolGeneration;
}

export type AuthoritativeGameRoomClass = new () => Room<{
  metadata: GameRoomMetadata;
}>;

interface RuntimeSlot {
  readonly slotId: PlayerSlotId;
  playerSessionId: string | null;
  userId: string | null;
  reservedUntilMilliseconds: number | null;
  assignment: string | null;
  timeout: CancelTimer | null;
}

interface RuntimeAggregate {
  readonly definition: UnknownGameDefinition;
  initialConfig: JsonValue;
  readonly roomCode: string;
  readonly slots: RuntimeSlot[];
  readonly setupProtocol: SetupProtocolGeneration;
  readonly setupDefinition: UnknownRoundSetupDefinition | null;
  nextRoundSetup: RoundSetupCoordinatorState | null;
  previousFinalizedSetup: FinalizedRoundSetup | null;
  targetPlayerCount: number;
  currentRound: RuntimeRound | null;
}

interface RuntimeRound {
  readonly replayId: string;
  readonly roundNumber: number;
  readonly playerOrder: readonly PlayerSlotId[];
  state: JsonValue;
  rng: RngState;
  revision: number;
  status: Exclude<MatchStatus, "waiting">;
  outcome: JsonValue | null;
}

interface PendingRound {
  readonly replayId: string;
  readonly roundNumber: number;
  readonly playerOrder: readonly PlayerSlotId[];
  readonly config: JsonValue;
  readonly assignments: readonly {
    readonly slotId: string;
    readonly assignment: string | null;
  }[];
  readonly finalizedSetup: FinalizedRoundSetup | null;
  readonly initialRng: RngState;
  readonly initialized: {
    readonly state: JsonValue;
    readonly rng: RngState;
  } | null;
}

type RuntimeCommandOutcome =
  ServerMessage | ServerMessageV6 | RoomLifecycleState | RoomLifecycleStateV6;

type AnyGameRoomRequest = GameRoomRequest | GameRoomRequestV6;
type AnyCreateGameRoomRequest = CreateGameRoomRequest | CreateGameRoomRequestV6;

function requestedProtocolVersion(input: unknown): unknown {
  return input !== null &&
    typeof input === "object" &&
    "protocolVersion" in input
    ? (input as { readonly protocolVersion?: unknown }).protocolVersion
    : undefined;
}

function parseGameRoomRequest(input: unknown): AnyGameRoomRequest | null {
  const schema =
    requestedProtocolVersion(input) === SETUP_PROTOCOL_VERSION
      ? gameRoomRequestV6Schema
      : gameRoomRequestSchema;
  const parsed = schema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

function parseCreateGameRoomRequest(
  input: unknown,
  setupProtocol: SetupProtocolGeneration,
): AnyCreateGameRoomRequest | null {
  const schema =
    setupProtocol === SETUP_PROTOCOL_VERSION
      ? createGameRoomRequestV6Schema
      : createGameRoomRequestSchema;
  const parsed = schema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

interface RuntimeClientData {
  readonly playerSessionId: string;
  readonly userId: string | null;
  readonly slotId: PlayerSlotId;
  counted: boolean;
}

function protocolServerError(code: ProtocolErrorCode): ServerError {
  const status = code === "UNAUTHENTICATED" ? 401 : 400;
  return new ServerError(status, code);
}

function validReturnedRng(
  rng: Readonly<RngState>,
  previous: Readonly<RngState>,
): boolean {
  return (
    rng.algorithm === RNG_ALGORITHM_V1 &&
    rng.seed === previous.seed &&
    Number.isSafeInteger(rng.cursor) &&
    rng.cursor >= previous.cursor
  );
}

function retryable(code: ProtocolErrorCode): boolean {
  return (
    code === "STALE_REVISION" ||
    code === "STALE_SETUP_REVISION" ||
    code === "SETUP_NOT_READY" ||
    code === "RATE_LIMITED"
  );
}

export function createAuthoritativeGameRoomClass(
  dependencies: AuthoritativeGameRoomDependencies,
): AuthoritativeGameRoomClass {
  const ids = dependencies.ids ?? secureRuntimeIdSource;
  const matchArchive = dependencies.matchArchive ?? new NoopMatchArchive();
  const metrics = dependencies.metrics ?? new InMemoryMetricsCollector();
  const logger = dependencies.logger ?? noopRuntimeLogger;
  const reconnectGrace =
    dependencies.reconnectGraceMilliseconds ??
    DEFAULT_RECONNECT_GRACE_MILLISECONDS;
  if (!Number.isSafeInteger(reconnectGrace) || reconnectGrace < 0) {
    throw new RangeError("Reconnect grace must be a non-negative integer.");
  }
  const terminalRoomTtl =
    dependencies.terminalRoomTtlMilliseconds ??
    DEFAULT_TERMINAL_ROOM_TTL_MILLISECONDS;
  if (!Number.isSafeInteger(terminalRoomTtl) || terminalRoomTtl < 0) {
    throw new RangeError("Terminal room TTL must be a non-negative integer.");
  }

  const gaugeValues = new Map<string, number>();
  const adjustGauge = (
    name: Extract<RuntimeMetricName, "active_rooms" | "active_connections">,
    delta: number,
    labels: MetricLabels,
  ): void => {
    const key = `${name}:${labels.gameId ?? ""}:${labels.gameVersion ?? ""}`;
    const value = Math.max(0, (gaugeValues.get(key) ?? 0) + delta);
    gaugeValues.set(key, value);
    metrics.setGauge(name, value, labels);
  };

  return class AuthoritativeGameRoom extends Room<{
    metadata: GameRoomMetadata;
  }> {
    #aggregate: RuntimeAggregate | undefined;
    #creatorSessionId: string | undefined;
    #queue: Promise<void> = Promise.resolve();
    readonly #activeClientBySession = new Map<string, Client>();
    readonly #commandOutcomes = new Map<string, RuntimeCommandOutcome>();
    readonly #readySessions = new Set<string>();
    #terminalTimeout: CancelTimer | null = null;
    #closedReason: RoomCloseReason | null = null;
    #starterChoice: StarterChoice | null = null;
    #pendingRound: PendingRound | null = null;
    #pendingNextRoundSetup: RoundSetupCoordinatorState | null = null;
    #rematchOrder: readonly PlayerSlotId[] | null = null;
    #disposed = false;

    public static override async onAuth(
      _token: string,
      options: unknown,
    ): Promise<{
      readonly playerSessionId: string;
      readonly userId: string | null;
    }> {
      const request = parseGameRoomRequest(options);
      if (request === null) {
        const requested = requestedProtocolVersion(options);
        const unsupported =
          requested !== PROTOCOL_VERSION &&
          requested !== SETUP_PROTOCOL_VERSION;
        throw protocolServerError(
          unsupported
            ? "PROTOCOL_VERSION_UNSUPPORTED"
            : "INVALID_ACTION_PAYLOAD",
        );
      }
      const verification = await dependencies.ticketVerifier.verify(
        request.ticket,
      );
      if (verification.status === "rejected") {
        throw protocolServerError(verification.protocolCode);
      }
      if (verification.claims.protocolVersion !== request.protocolVersion) {
        throw protocolServerError("PROTOCOL_VERSION_UNSUPPORTED");
      }
      return {
        playerSessionId: verification.playerSessionId,
        userId: verification.userId,
      };
    }

    public override async onCreate(options: unknown): Promise<void> {
      const genericRequest = parseGameRoomRequest(options);
      if (
        genericRequest === null ||
        genericRequest.type !== "room.create" ||
        !isJsonValue(genericRequest.initialConfig)
      ) {
        throw protocolServerError(
          this.#requestProtocolCode(options, "INVALID_ACTION_PAYLOAD"),
        );
      }
      const definition = dependencies.resolveCurrentDefinition(
        genericRequest.gameId,
      );
      if (definition === undefined) {
        throw protocolServerError("ROOM_NOT_FOUND");
      }
      const setupProtocol = dependencies.resolveSetupProtocol(
        definition.manifest.id,
        definition.manifest.gameVersion,
      );
      if (setupProtocol === undefined) {
        throw new ServerError(500, "INTERNAL_ERROR");
      }
      const request = parseCreateGameRoomRequest(options, setupProtocol);
      if (request === null || !isJsonValue(request.initialConfig)) {
        throw protocolServerError("PROTOCOL_VERSION_UNSUPPORTED");
      }
      const verification = await dependencies.ticketVerifier.verify(
        request.ticket,
      );
      if (verification.status === "rejected") {
        throw protocolServerError(verification.protocolCode);
      }
      if (verification.claims.protocolVersion !== setupProtocol) {
        throw protocolServerError("PROTOCOL_VERSION_UNSUPPORTED");
      }
      const configResult = definition.configSchema.safeParse(
        request.initialConfig,
      );
      if (!configResult.success || !isJsonValue(configResult.data)) {
        throw protocolServerError("INVALID_ACTION_PAYLOAD");
      }
      const { minPlayers, maxPlayers } = definition.manifest;
      if (
        !Number.isSafeInteger(minPlayers) ||
        !Number.isSafeInteger(maxPlayers) ||
        minPlayers <= 0 ||
        maxPlayers < minPlayers ||
        minPlayers < 2 ||
        maxPlayers > 6
      ) {
        throw new ServerError(500, "INTERNAL_ERROR");
      }

      const roomCode = await this.#createUniqueRoomCode();
      const slots = Array.from({ length: maxPlayers }, (_, index) => ({
        slotId: ids.createPlayerSlotId(index),
        playerSessionId: index === 0 ? verification.playerSessionId : null,
        userId: index === 0 ? verification.userId : null,
        reservedUntilMilliseconds: null,
        assignment: null,
        timeout: null,
      }));
      if (new Set(slots.map((slot) => slot.slotId)).size !== slots.length) {
        throw new ServerError(500, "INTERNAL_ERROR");
      }
      const setupDefinition =
        setupProtocol === SETUP_PROTOCOL_VERSION
          ? dependencies.resolveRoundSetupDefinition(
              definition.manifest.id,
              definition.manifest.gameVersion,
            )
          : null;
      if (
        setupProtocol === SETUP_PROTOCOL_VERSION &&
        setupDefinition === undefined
      ) {
        throw new ServerError(500, "INTERNAL_ERROR");
      }
      let nextRoundSetup: RoundSetupCoordinatorState | null = null;
      if (setupDefinition !== null && setupDefinition !== undefined) {
        try {
          nextRoundSetup = initializeRoundSetupCoordinator(
            setupDefinition,
            {
              source: {
                kind: "defaults",
                config: configResult.data as SetupJsonValue,
              },
              slots: slots.map((slot) => ({
                slotId: slot.slotId,
                occupied: slot.playerSessionId !== null,
                online: false,
                isOwner: slot.playerSessionId === verification.playerSessionId,
              })),
            },
            createSetupRng(ids.createRngSeed()),
          );
        } catch {
          throw new ServerError(500, "INTERNAL_ERROR");
        }
      }

      this.autoDispose = false;
      this.patchRate = null;
      this.maxClients = maxPlayers * 2;
      this.maxMessagesPerSecond = 30;
      this.#creatorSessionId = verification.playerSessionId;
      this.#aggregate = {
        definition,
        initialConfig: configResult.data,
        roomCode,
        slots,
        setupProtocol,
        setupDefinition: setupDefinition ?? null,
        nextRoundSetup,
        previousFinalizedSetup: null,
        targetPlayerCount: minPlayers,
        currentRound: null,
      };

      const storedRoom = this.#storedRoom();
      await dependencies.roomStore.create(storedRoom);
      await this.setMetadata({
        roomCode,
        gameId: definition.manifest.id,
        gameVersion: definition.manifest.gameVersion,
        setupProtocol,
      });

      const labels = this.#labels();
      adjustGauge("active_rooms", 1, labels);
      this.onMessage(GAME_ACTION_MESSAGE, (client, message: unknown) =>
        this.#enqueue(() => this.#handleAction(client, message)),
      );
      this.onMessage(ROOM_CONTROL_MESSAGE, (client, message: unknown) =>
        this.#enqueue(() => this.#handleControl(client, message)),
      );
      if (setupProtocol === SETUP_PROTOCOL_VERSION) {
        this.onMessage(GAME_SETUP_MESSAGE, (client, message: unknown) =>
          this.#enqueue(() => this.#handleSetup(client, message)),
        );
      }
      logger.write({
        event: "room.created",
        roomId: this.roomId,
        ...labels,
        revision: 0,
        status: "waiting",
        sessionCorrelationId: correlatePlayerSessionId(
          verification.playerSessionId,
        ),
      });
    }

    public override async onJoin(
      client: Client,
      options: unknown,
    ): Promise<void> {
      await this.#enqueue(async () => {
        const aggregate = this.#requireAggregate();
        const playerSessionId = this.#clientSession(client);
        const userId = this.#clientUserId(client);
        const request = parseGameRoomRequest(options);
        if (
          request === null ||
          request.protocolVersion !== aggregate.setupProtocol
        ) {
          throw protocolServerError(
            this.#requestProtocolCode(
              options,
              "INVALID_ACTION_PAYLOAD",
              aggregate.setupProtocol,
            ),
          );
        }
        if (
          dependencies.resolveDefinition(
            aggregate.definition.manifest.id,
            aggregate.definition.manifest.gameVersion,
          ) === undefined
        ) {
          throw protocolServerError("ROOM_NOT_FOUND");
        }
        if (
          request.type === "room.create"
            ? playerSessionId !== this.#creatorSessionId ||
              request.gameId !== aggregate.definition.manifest.id
            : request.roomCode !== aggregate.roomCode
        ) {
          throw protocolServerError("NOT_A_PLAYER");
        }
        if (this.#closedReason !== null) {
          throw protocolServerError("MATCH_NOT_ACTIVE");
        }

        let slot = aggregate.slots.find(
          (candidate) => candidate.playerSessionId === playerSessionId,
        );
        if (slot !== undefined && slot.userId !== userId) {
          throw protocolServerError("NOT_A_PLAYER");
        }
        if (slot === undefined) {
          if (aggregate.currentRound?.status === "completed") {
            throw protocolServerError("ROOM_NOT_JOINABLE");
          }
          if (request.type !== "room.join") {
            throw protocolServerError("NOT_A_PLAYER");
          }
          slot = aggregate.slots.find(
            (candidate) => candidate.playerSessionId === null,
          );
          if (slot === undefined || aggregate.currentRound !== null) {
            throw protocolServerError("ROOM_FULL");
          }
          slot.playerSessionId = playerSessionId;
          slot.userId = userId;
        }

        const wasReconnect = slot.reservedUntilMilliseconds !== null;
        if (wasReconnect) {
          metrics.increment("reconnect_attempt_total", this.#labels());
          metrics.increment("reconnect_success_total", this.#labels());
        }
        slot.timeout?.cancel();
        slot.timeout = null;
        slot.reservedUntilMilliseconds = null;

        const previousClient = this.#activeClientBySession.get(playerSessionId);
        this.#clearReadyForSlot(slot.slotId);
        this.#activeClientBySession.set(playerSessionId, client);
        const clientData: RuntimeClientData = {
          playerSessionId,
          userId,
          slotId: slot.slotId,
          counted: true,
        };
        client.userData = clientData;
        adjustGauge("active_connections", 1, this.#labels());
        if (previousClient !== undefined && previousClient !== client) {
          metrics.increment("reconnect_attempt_total", this.#labels());
          metrics.increment("reconnect_success_total", this.#labels());
          previousClient.leave(4001, "connection replaced");
        }

        const storedRoom = this.#storedRoom();
        if (aggregate.currentRound !== null) {
          await matchArchive.saveRound(storedRoom);
        }
        await dependencies.roomStore.save(storedRoom);
        this.#sendConnected(client, slot.slotId);
        this.#broadcastLifecycle();
        if (aggregate.currentRound !== null) {
          this.#sendSnapshot(client);
        }
        logger.write({
          event: wasReconnect ? "connection.reconnected" : "connection.joined",
          roomId: this.roomId,
          ...this.#labels(),
          revision: aggregate.currentRound?.revision ?? 0,
          status: aggregate.currentRound?.status ?? "waiting",
          sessionCorrelationId: correlatePlayerSessionId(playerSessionId),
        });
      });
    }

    public override async onLeave(
      client: Client,
      code?: number,
    ): Promise<void> {
      await this.#enqueue(async () => {
        const clientData = client.userData as RuntimeClientData | undefined;
        if (clientData === undefined) {
          return;
        }
        if (clientData.counted) {
          clientData.counted = false;
          adjustGauge("active_connections", -1, this.#labels());
        }
        if (
          this.#activeClientBySession.get(clientData.playerSessionId) !== client
        ) {
          return;
        }
        this.#activeClientBySession.delete(clientData.playerSessionId);
        const readyChanged = this.#clearReadyForSlot(clientData.slotId);
        const aggregate = this.#requireAggregate();
        if (this.#closedReason !== null || this.#disposed) {
          return;
        }
        if (code === CloseCode.CONSENTED) {
          if (
            aggregate.currentRound === null ||
            aggregate.currentRound.status === "active"
          ) {
            await this.#closeRoom("PLAYER_LEFT");
          } else {
            if (readyChanged) {
              await dependencies.roomStore.save(this.#storedRoom());
            }
            this.#broadcastLifecycle();
          }
          return;
        }
        if (aggregate.currentRound?.status === "completed") {
          if (readyChanged) {
            await dependencies.roomStore.save(this.#storedRoom());
          }
          this.#broadcastLifecycle();
          return;
        }
        const slot = aggregate.slots.find(
          (candidate) => candidate.slotId === clientData.slotId,
        );
        if (slot === undefined) {
          return;
        }
        slot.timeout?.cancel();
        slot.reservedUntilMilliseconds =
          dependencies.clock.nowMilliseconds() + reconnectGrace;
        slot.timeout = dependencies.clock.setTimeout(() => {
          void this.#enqueue(() => this.#expireDisconnectedSlot(slot));
        }, reconnectGrace);
        const storedRoom = this.#storedRoom();
        if (aggregate.currentRound !== null) {
          await matchArchive.saveRound(storedRoom);
        }
        await dependencies.roomStore.save(storedRoom);
        logger.write({
          event: "connection.left",
          roomId: this.roomId,
          ...this.#labels(),
          revision: aggregate.currentRound?.revision ?? 0,
          status: aggregate.currentRound?.status ?? "waiting",
          sessionCorrelationId: correlatePlayerSessionId(
            clientData.playerSessionId,
          ),
        });
      });
    }

    public override async onDispose(): Promise<void> {
      this.#disposed = true;
      const aggregate = this.#aggregate;
      if (aggregate === undefined) {
        return;
      }
      for (const slot of aggregate.slots) {
        slot.timeout?.cancel();
      }
      this.#terminalTimeout?.cancel();
      this.#terminalTimeout = null;
      adjustGauge("active_rooms", -1, this.#labels());
    }

    public override onUncaughtException(
      error: RoomException,
      methodName: RoomMethodName,
    ): void {
      if (
        (methodName === "onAuth" ||
          methodName === "onCreate" ||
          methodName === "onJoin") &&
        error.cause instanceof ServerError &&
        error.cause.code >= 400 &&
        error.cause.code < 500
      ) {
        return;
      }
      const aggregate = this.#aggregate;
      metrics.increment(
        "room_crash_total",
        aggregate === undefined ? {} : this.#labels(),
      );
      logger.write({
        event: "room.crashed",
        roomId: this.roomId,
        ...(aggregate === undefined ? {} : this.#labels()),
        ...(aggregate?.currentRound === undefined ||
        aggregate.currentRound === null
          ? {}
          : { revision: aggregate.currentRound.revision }),
        code: "ROOM_CRASH",
      });
    }

    async #handleAction(client: Client, rawMessage: unknown): Promise<void> {
      const aggregate = this.#requireAggregate();
      const parsed =
        aggregate.setupProtocol === SETUP_PROTOCOL_VERSION
          ? gameActionCommandV6Schema.safeParse(rawMessage)
          : gameActionCommandSchema.safeParse(rawMessage);
      if (!parsed.success) {
        this.#sendRejection(
          client,
          this.#requestProtocolCode(
            rawMessage,
            "INVALID_ACTION_PAYLOAD",
            aggregate.setupProtocol,
          ),
        );
        return;
      }
      const command = parsed.data;
      const clientData = client.userData as RuntimeClientData | undefined;
      if (
        clientData === undefined ||
        this.#activeClientBySession.get(clientData.playerSessionId) !== client
      ) {
        this.#sendRejection(client, "NOT_A_PLAYER", command.commandId);
        return;
      }
      const commandKey = `${clientData.playerSessionId}\u0000${command.commandId}`;
      const duplicate = this.#commandOutcomes.get(commandKey);
      if (duplicate !== undefined) {
        this.#sendCommandOutcome(client, duplicate);
        return;
      }

      const round = aggregate.currentRound;
      if (round === null || round.status !== "active") {
        this.#rejectAndCache(
          client,
          commandKey,
          "MATCH_NOT_ACTIVE",
          command.commandId,
        );
        return;
      }
      if (command.roundNumber !== round.roundNumber) {
        this.#rejectAndCache(
          client,
          commandKey,
          "STALE_REVISION",
          command.commandId,
          this.#snapshotFor(client),
        );
        return;
      }
      const slot = aggregate.slots.find(
        (candidate) => candidate.slotId === clientData.slotId,
      );
      if (
        slot === undefined ||
        slot.playerSessionId !== clientData.playerSessionId ||
        !round.playerOrder.includes(slot.slotId)
      ) {
        this.#rejectAndCache(
          client,
          commandKey,
          "NOT_A_PLAYER",
          command.commandId,
        );
        return;
      }
      if (command.expectedRevision !== round.revision) {
        this.#rejectAndCache(
          client,
          commandKey,
          "STALE_REVISION",
          command.commandId,
          this.#snapshotFor(client),
        );
        return;
      }

      const actionResult = aggregate.definition.actionSchema.safeParse(
        command.action,
      );
      if (!actionResult.success || !isJsonValue(actionResult.data)) {
        this.#rejectAndCache(
          client,
          commandKey,
          "INVALID_ACTION_PAYLOAD",
          command.commandId,
        );
        return;
      }

      let transitioned: ReturnType<UnknownGameDefinition["transition"]>;
      try {
        transitioned = aggregate.definition.transition({
          state: round.state,
          actorSlotId: slot.slotId,
          action: actionResult.data,
          rng: round.rng,
        });
      } catch {
        this.#roomCrash(client, command.commandId);
        return;
      }
      if (transitioned.status === "rejected") {
        this.#rejectAndCache(
          client,
          commandKey,
          "GAME_RULE_REJECTED",
          command.commandId,
          undefined,
          transitioned.code,
        );
        return;
      }
      if (
        !isJsonValue(transitioned.state) ||
        !validReturnedRng(transitioned.rng, round.rng)
      ) {
        this.#roomCrash(client, command.commandId);
        return;
      }

      let outcome: JsonValue | null;
      try {
        outcome = aggregate.definition.getOutcome(transitioned.state);
      } catch {
        this.#roomCrash(client, command.commandId);
        return;
      }
      if (!isJsonValue(outcome)) {
        this.#roomCrash(client, command.commandId);
        return;
      }

      const nextRevision = round.revision + 1;
      let nextRoundSetupCandidate: RoundSetupCoordinatorState | null = null;
      if (
        outcome !== null &&
        aggregate.setupProtocol === SETUP_PROTOCOL_VERSION
      ) {
        try {
          nextRoundSetupCandidate = this.#createNextRoundSetupCandidate();
        } catch {
          this.#roomCrash(client, command.commandId);
          return;
        }
      }
      try {
        await dependencies.replayStore.append(round.replayId, round.revision, {
          sequence: nextRevision,
          actorSlotId: slot.slotId,
          action: actionResult.data,
        });
        if (outcome !== null) {
          await dependencies.replayStore.complete(
            round.replayId,
            nextRevision,
            transitioned.rng.cursor,
            outcome,
          );
        }
        const storedRoom = this.#storedRoom(
          {
            state: transitioned.state,
            rng: transitioned.rng,
            revision: nextRevision,
            status: outcome === null ? round.status : "completed",
            outcome,
          },
          this.#closedReason,
          {
            ...(nextRoundSetupCandidate === null
              ? {}
              : { nextRoundSetup: nextRoundSetupCandidate }),
          },
        );
        await matchArchive.saveRound(storedRoom);
        await dependencies.roomStore.save(storedRoom);
      } catch {
        metrics.increment("replay_append_failure_total", this.#labels());
        this.#rejectAndCache(
          client,
          commandKey,
          "INTERNAL_ERROR",
          command.commandId,
        );
        return;
      }

      round.state = transitioned.state;
      round.rng = transitioned.rng;
      round.revision = nextRevision;
      round.outcome = outcome;
      if (outcome !== null) {
        round.status = "completed";
        if (aggregate.setupProtocol === SETUP_PROTOCOL_VERSION) {
          aggregate.nextRoundSetup = nextRoundSetupCandidate;
          this.#pendingNextRoundSetup = null;
        } else {
          this.#starterChoice = null;
          this.#rematchOrder = null;
          this.#readySessions.clear();
        }
        this.#scheduleTerminalExpiry();
      }

      metrics.increment("actions_accepted_total", this.#labels());
      const result = this.#snapshotFor(client, command.commandId);
      this.#commandOutcomes.set(commandKey, result);
      if (outcome !== null) {
        this.#broadcastLifecycle();
      }
      this.#broadcastSnapshots(client, command.commandId);
      logger.write({
        event: "action.accepted",
        roomId: this.roomId,
        ...this.#labels(),
        revision: round.revision,
        status: round.status,
        sessionCorrelationId: correlatePlayerSessionId(
          clientData.playerSessionId,
        ),
      });
    }

    async #handleSetup(client: Client, rawMessage: unknown): Promise<void> {
      const aggregate = this.#requireAggregate();
      if (aggregate.setupProtocol !== SETUP_PROTOCOL_VERSION) {
        this.#sendRejection(client, "PROTOCOL_VERSION_UNSUPPORTED");
        return;
      }
      const parsed = gameSetupCommandSchema.safeParse(rawMessage);
      if (!parsed.success) {
        this.#sendRejection(
          client,
          this.#requestProtocolCode(
            rawMessage,
            "INVALID_SETUP_PAYLOAD",
            SETUP_PROTOCOL_VERSION,
          ),
        );
        return;
      }
      const command = parsed.data;
      const clientData = client.userData as RuntimeClientData | undefined;
      if (
        clientData === undefined ||
        this.#activeClientBySession.get(clientData.playerSessionId) !== client
      ) {
        this.#sendRejection(client, "NOT_A_PLAYER", command.commandId);
        return;
      }
      const commandKey = `${clientData.playerSessionId}\u0000${command.commandId}`;
      const duplicate = this.#commandOutcomes.get(commandKey);
      if (duplicate !== undefined) {
        this.#sendCommandOutcome(client, duplicate);
        return;
      }

      const setupDefinition = aggregate.setupDefinition;
      const coordinator = aggregate.nextRoundSetup;
      const nextRoundNumber = (aggregate.currentRound?.roundNumber ?? 0) + 1;
      if (
        this.#closedReason !== null ||
        setupDefinition === null ||
        coordinator === null ||
        command.roundNumber !== nextRoundNumber
      ) {
        this.#rejectSetupAndCache(
          client,
          commandKey,
          "SETUP_NOT_READY",
          command.commandId,
          coordinator?.setupRevision,
        );
        return;
      }
      const slot = aggregate.slots.find(
        (candidate) => candidate.slotId === clientData.slotId,
      );
      if (
        slot === undefined ||
        slot.playerSessionId !== clientData.playerSessionId
      ) {
        this.#rejectSetupAndCache(
          client,
          commandKey,
          "NOT_A_PLAYER",
          command.commandId,
          coordinator.setupRevision,
        );
        return;
      }
      const parsedAction = setupDefinition.setupActionSchema.safeParse(
        command.action,
      );
      if (!parsedAction.success) {
        this.#rejectSetupAndCache(
          client,
          commandKey,
          "INVALID_SETUP_PAYLOAD",
          command.commandId,
          coordinator.setupRevision,
        );
        return;
      }

      let result: ReturnType<typeof applyRoundSetupAction>;
      try {
        result = applyRoundSetupAction(setupDefinition, coordinator, {
          action: parsedAction.data,
          actorSlotId: slot.slotId,
          isOwner: clientData.playerSessionId === this.#creatorSessionId,
          expectedSetupRevision: command.expectedSetupRevision,
          slots: this.#setupSlots(),
        });
      } catch {
        this.#roomCrash(client, command.commandId);
        return;
      }
      if (result.status === "stale") {
        this.#rejectSetupAndCache(
          client,
          commandKey,
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
          this.#roomCrash(client, command.commandId);
          return;
        }
        this.#rejectSetupAndCache(
          client,
          commandKey,
          "SETUP_RULE_REJECTED",
          command.commandId,
          coordinator.setupRevision,
          result.code,
        );
        return;
      }

      try {
        await dependencies.roomStore.save(
          this.#storedRoom({}, this.#closedReason, {
            nextRoundSetup: result.coordinator,
          }),
        );
      } catch {
        this.#sendRejection(client, "INTERNAL_ERROR", command.commandId);
        return;
      }
      aggregate.nextRoundSetup = result.coordinator;
      this.#pendingRound = null;
      const lifecycle = this.#lifecycleFor(client, command.commandId);
      this.#commandOutcomes.set(commandKey, lifecycle);
      this.#broadcastLifecycle(client, command.commandId);
    }

    async #handleControl(client: Client, rawMessage: unknown): Promise<void> {
      const aggregate = this.#requireAggregate();
      const parsed =
        aggregate.setupProtocol === SETUP_PROTOCOL_VERSION
          ? roomControlCommandV6Schema.safeParse(rawMessage)
          : roomControlCommandSchema.safeParse(rawMessage);
      if (!parsed.success) {
        this.#sendRejection(
          client,
          this.#requestProtocolCode(
            rawMessage,
            "INVALID_ACTION_PAYLOAD",
            aggregate.setupProtocol,
          ),
        );
        return;
      }
      const command = parsed.data;
      const clientData = client.userData as RuntimeClientData | undefined;
      if (
        clientData === undefined ||
        this.#activeClientBySession.get(clientData.playerSessionId) !== client
      ) {
        this.#sendRejection(client, "NOT_A_PLAYER", command.commandId);
        return;
      }
      const commandKey = `${clientData.playerSessionId}\u0000${command.commandId}`;
      const duplicate = this.#commandOutcomes.get(commandKey);
      if (duplicate !== undefined) {
        this.#sendCommandOutcome(client, duplicate);
        return;
      }

      if (command.operation === "CLOSE_ROOM") {
        if (clientData.playerSessionId !== this.#creatorSessionId) {
          this.#rejectControlAndCache(
            client,
            commandKey,
            "ROOM_CONTROL_NOT_ALLOWED",
            command.commandId,
          );
          return;
        }
        try {
          await this.#closeRoom(
            "OWNER_CLOSED",
            client,
            command.commandId,
            commandKey,
          );
        } catch {
          this.#rejectControlAndCache(
            client,
            commandKey,
            "INTERNAL_ERROR",
            command.commandId,
          );
        }
        return;
      }

      if (aggregate.setupProtocol === SETUP_PROTOCOL_VERSION) {
        await this.#handleSetupControl(
          client,
          command as RoomControlCommandV6,
          commandKey,
        );
        return;
      }

      if (
        this.#closedReason !== null ||
        (aggregate.currentRound !== null &&
          aggregate.currentRound.status !== "completed")
      ) {
        this.#rejectControlAndCache(
          client,
          commandKey,
          "ROOM_CONTROL_NOT_ALLOWED",
          command.commandId,
        );
        return;
      }

      if (command.operation === "SELECT_PLAYER_COUNT") {
        if (clientData.playerSessionId !== this.#creatorSessionId) {
          this.#rejectControlAndCache(
            client,
            commandKey,
            "ROOM_CONTROL_NOT_ALLOWED",
            command.commandId,
          );
          return;
        }
        const { minPlayers, maxPlayers } = aggregate.definition.manifest;
        const occupied = aggregate.slots.filter(
          (slot) => slot.playerSessionId !== null,
        ).length;
        if (
          command.playerCount < minPlayers ||
          command.playerCount > maxPlayers ||
          occupied > command.playerCount
        ) {
          this.#rejectControlAndCache(
            client,
            commandKey,
            "ROOM_CONTROL_NOT_ALLOWED",
            command.commandId,
          );
          return;
        }
        if (aggregate.targetPlayerCount !== command.playerCount) {
          aggregate.targetPlayerCount = command.playerCount;
          this.#readySessions.clear();
          this.#pendingRound = null;
          this.#rematchOrder = null;
        }
      } else if (
        command.operation === "SELECT_PLAYER_ASSIGNMENT" ||
        command.operation === "CLEAR_PLAYER_ASSIGNMENT"
      ) {
        if (
          aggregate.definition.manifest.capabilities.playerAssignment ===
          undefined
        ) {
          this.#rejectControlAndCache(
            client,
            commandKey,
            "ROOM_CONTROL_NOT_ALLOWED",
            command.commandId,
          );
          return;
        }
        const slot = aggregate.slots.find(
          (candidate) =>
            candidate.playerSessionId === clientData.playerSessionId,
        );
        if (slot === undefined) {
          this.#rejectControlAndCache(
            client,
            commandKey,
            "NOT_A_PLAYER",
            command.commandId,
          );
          return;
        }
        const assignment =
          command.operation === "CLEAR_PLAYER_ASSIGNMENT"
            ? null
            : command.assignment;
        if (
          assignment !== null &&
          !aggregate.definition.manifest.capabilities.playerAssignment.options.includes(
            assignment,
          )
        ) {
          this.#rejectControlAndCache(
            client,
            commandKey,
            "ROOM_CONTROL_NOT_ALLOWED",
            command.commandId,
          );
          return;
        }
        const conflict =
          assignment !== null &&
          aggregate.slots.some(
            (candidate) =>
              candidate !== slot &&
              candidate.playerSessionId !== null &&
              candidate.assignment === assignment,
          );
        if (conflict) {
          this.#rejectControlAndCache(
            client,
            commandKey,
            "ROOM_CONTROL_NOT_ALLOWED",
            command.commandId,
          );
          return;
        }
        slot.assignment = assignment;
        this.#readySessions.clear();
        this.#pendingRound = null;
        this.#rematchOrder = null;
      }

      let startedRound = false;
      if (command.operation === "SELECT_STARTER") {
        if (clientData.playerSessionId !== this.#creatorSessionId) {
          this.#rejectControlAndCache(
            client,
            commandKey,
            "ROOM_CONTROL_NOT_ALLOWED",
            command.commandId,
          );
          return;
        }
        if (this.#starterChoice !== command.starter) {
          this.#starterChoice = command.starter;
          this.#readySessions.clear();
          this.#pendingRound = null;
          this.#rematchOrder = null;
        }
      } else if (command.operation === "START_REMATCH") {
        if (!this.#allParticipantsConnected()) {
          this.#rejectControlAndCache(
            client,
            commandKey,
            "ROOM_CONTROL_NOT_ALLOWED",
            command.commandId,
          );
          return;
        }
        const completedRound = aggregate.currentRound;
        const ownerSlot = aggregate.slots.find(
          (slot) => slot.playerSessionId === this.#creatorSessionId,
        );
        if (
          completedRound === null ||
          completedRound.status !== "completed" ||
          ownerSlot === undefined
        ) {
          this.#rejectControlAndCache(
            client,
            commandKey,
            "ROOM_CONTROL_NOT_ALLOWED",
            command.commandId,
          );
          return;
        }
        this.#starterChoice =
          completedRound.playerOrder[0] === ownerSlot.slotId
            ? "OWNER"
            : "NON_OWNER";
        this.#rematchOrder = [...completedRound.playerOrder];
        this.#readySessions.clear();
        for (const slot of aggregate.slots) {
          if (slot.playerSessionId !== null) {
            this.#readySessions.add(slot.playerSessionId);
          }
        }
        this.#pendingRound = null;
      } else if (command.operation === "CANCEL_ROUND_READY") {
        this.#readySessions.delete(clientData.playerSessionId);
      } else if (command.operation === "READY_FOR_ROUND") {
        if (this.#starterChoice === null) {
          this.#rejectControlAndCache(
            client,
            commandKey,
            "ROOM_CONTROL_NOT_ALLOWED",
            command.commandId,
          );
          return;
        }
        this.#readySessions.add(clientData.playerSessionId);
      }
      if (
        this.#starterChoice !== null &&
        this.#allParticipantsReadyAndConnected()
      ) {
        try {
          await this.#startRound();
          startedRound = true;
        } catch {
          this.#rejectControlAndCache(
            client,
            commandKey,
            "INTERNAL_ERROR",
            command.commandId,
          );
          return;
        }
      }

      const lifecycle = this.#lifecycleFor(client, command.commandId);
      this.#commandOutcomes.set(commandKey, lifecycle);
      this.#broadcastLifecycle(client, command.commandId);
      if (startedRound) {
        this.#broadcastSnapshots();
      }
    }

    async #handleSetupControl(
      client: Client,
      command: RoomControlCommandV6,
      commandKey: string,
    ): Promise<void> {
      const aggregate = this.#requireAggregate();
      const setupDefinition = aggregate.setupDefinition;
      const coordinator = aggregate.nextRoundSetup;
      const clientData = client.userData as RuntimeClientData;
      if (
        this.#closedReason !== null ||
        setupDefinition === null ||
        coordinator === null ||
        (aggregate.currentRound !== null &&
          aggregate.currentRound.status !== "completed")
      ) {
        this.#rejectSetupAndCache(
          client,
          commandKey,
          "SETUP_NOT_READY",
          command.commandId,
          coordinator?.setupRevision,
        );
        return;
      }
      const slot = aggregate.slots.find(
        (candidate) => candidate.slotId === clientData.slotId,
      );
      if (
        slot === undefined ||
        slot.playerSessionId !== clientData.playerSessionId
      ) {
        this.#rejectSetupAndCache(
          client,
          commandKey,
          "NOT_A_PLAYER",
          command.commandId,
          coordinator.setupRevision,
        );
        return;
      }

      const setupSlots = this.#setupSlots();
      const readyResult = setRoundSetupReady(
        setupDefinition,
        coordinator,
        setupSlots,
        slot.slotId,
        command.operation === "READY_FOR_ROUND",
      );
      if (readyResult.status === "rejected") {
        this.#rejectSetupAndCache(
          client,
          commandKey,
          "SETUP_NOT_READY",
          command.commandId,
          coordinator.setupRevision,
          readyResult.code,
        );
        return;
      }

      let candidate = readyResult.coordinator;
      let shouldStart = false;
      if (command.operation === "READY_FOR_ROUND") {
        const readiness = getRoundSetupReadiness(
          setupDefinition,
          candidate,
          setupSlots,
          slot.slotId,
        );
        if (
          readiness.canFinalize &&
          readiness.requiredSlotIds.every((slotId) =>
            readiness.readySlotIds.includes(slotId),
          )
        ) {
          const finalized = finalizeRoundSetup(
            setupDefinition,
            candidate,
            setupSlots,
            aggregate.definition.manifest.minPlayers,
            aggregate.definition.manifest.maxPlayers,
          );
          if (finalized.status === "rejected") {
            this.#rejectSetupAndCache(
              client,
              commandKey,
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
          await dependencies.roomStore.save(
            this.#storedRoom({}, this.#closedReason, {
              nextRoundSetup: candidate,
            }),
          );
        } catch {
          this.#sendRejection(client, "INTERNAL_ERROR", command.commandId);
          return;
        }
        aggregate.nextRoundSetup = candidate;
      }

      if (shouldStart) {
        try {
          await this.#startRound();
        } catch {
          this.#sendRejection(client, "INTERNAL_ERROR", command.commandId);
          return;
        }
      }

      const lifecycle = this.#lifecycleFor(client, command.commandId);
      this.#commandOutcomes.set(commandKey, lifecycle);
      this.#broadcastLifecycle(client, command.commandId);
      if (shouldStart) {
        this.#broadcastSnapshots();
      }
    }

    async #startRound(): Promise<void> {
      const aggregate = this.#requireAggregate();
      if (
        (aggregate.currentRound !== null &&
          aggregate.currentRound.status !== "completed") ||
        (aggregate.setupProtocol === SETUP_PROTOCOL_VERSION
          ? !this.#v6SetupReadyToStart()
          : this.#starterChoice === null ||
            !this.#allParticipantsReadyAndConnected())
      ) {
        throw new Error("A round cannot start from the current lifecycle.");
      }
      const roundNumber = (aggregate.currentRound?.roundNumber ?? 0) + 1;
      if (roundNumber > Number.MAX_SAFE_INTEGER) {
        throw new Error("Room round number is exhausted.");
      }

      let pending = this.#pendingRound;
      if (pending === null) {
        const initialRng = createRng(ids.createRngSeed());
        let playerOrder: readonly PlayerSlotId[];
        let config: JsonValue;
        let assignments: PendingRound["assignments"];
        let finalizedSetup: FinalizedRoundSetup | null = null;
        if (aggregate.setupProtocol === SETUP_PROTOCOL_VERSION) {
          const finalized = aggregate.nextRoundSetup?.finalizedSetup;
          if (finalized === null || finalized === undefined) {
            throw new Error("Protocol V6 setup has not been finalized.");
          }
          if (!isJsonValue(finalized.config)) {
            throw new Error("Protocol V6 setup returned invalid config.");
          }
          playerOrder = finalized.playerOrder.map(
            (slotId) => slotId as PlayerSlotId,
          );
          config = finalized.config as JsonValue;
          assignments = finalized.assignments.map((entry) => ({ ...entry }));
          finalizedSetup = finalized;
        } else {
          const ownerSlot = aggregate.slots.find(
            (slot) => slot.playerSessionId === this.#creatorSessionId,
          );
          const participantSlots = aggregate.slots.filter(
            (slot) => slot.playerSessionId !== null,
          );
          if (
            ownerSlot === undefined ||
            participantSlots.length !== aggregate.targetPlayerCount
          ) {
            throw new Error("A round requires the selected number of players.");
          }
          const randomStartsWithOwner = nextInt(initialRng, 2).value === 0;
          const assignmentCapability =
            aggregate.definition.manifest.capabilities.playerAssignment;
          let orderedSlots = participantSlots.map((slot) => slot.slotId);
          if (assignmentCapability !== undefined) {
            const order = assignmentCapability.options;
            if (participantSlots.some((slot) => slot.assignment === null)) {
              throw new Error("Every player must select an assignment.");
            }
            orderedSlots = participantSlots
              .slice()
              .sort(
                (left, right) =>
                  order.indexOf(left.assignment as string) -
                  order.indexOf(right.assignment as string),
              )
              .map((slot) => slot.slotId);
          }
          if (this.#rematchOrder !== null) {
            orderedSlots = [...this.#rematchOrder];
          }
          const firstSlot =
            this.#starterChoice === "OWNER"
              ? ownerSlot.slotId
              : this.#starterChoice === "NON_OWNER"
                ? (orderedSlots.find((slotId) => slotId !== ownerSlot.slotId) ??
                  ownerSlot.slotId)
                : randomStartsWithOwner
                  ? ownerSlot.slotId
                  : (orderedSlots.find(
                      (slotId) => slotId !== ownerSlot.slotId,
                    ) ?? ownerSlot.slotId);
          const firstIndex = orderedSlots.indexOf(firstSlot);
          const legacyOrder: PlayerSlotId[] = [];
          if (firstIndex === -1) {
            legacyOrder.push(firstSlot, ...orderedSlots);
          } else {
            for (let offset = 0; offset < orderedSlots.length; offset += 1) {
              const slotId =
                orderedSlots[(firstIndex + offset) % orderedSlots.length];
              if (slotId === undefined) {
                throw new Error("The starter slot is not in player order.");
              }
              legacyOrder.push(slotId);
            }
          }
          playerOrder = legacyOrder;
          config = aggregate.initialConfig;
          assignments = legacyOrder.map((slotId) => ({
            slotId,
            assignment:
              aggregate.slots.find((slot) => slot.slotId === slotId)
                ?.assignment ?? null,
          }));
        }
        pending = {
          replayId: ids.createReplayId(),
          roundNumber,
          playerOrder,
          config,
          assignments,
          finalizedSetup,
          initialRng,
          initialized: null,
        };
        this.#pendingRound = pending;
      }

      if (pending.initialized === null) {
        let initialized: ReturnType<
          UnknownGameDefinition["createInitialState"]
        >;
        try {
          initialized = aggregate.definition.createInitialState({
            config: pending.config,
            players: pending.playerOrder,
            ...this.#playerAssignmentsFor(pending),
            rng: pending.initialRng,
          });
        } catch {
          throw new Error("The game could not initialize the next round.");
        }
        if (
          !isJsonValue(initialized.state) ||
          !validReturnedRng(initialized.rng, pending.initialRng)
        ) {
          throw new Error("The game returned an invalid next round.");
        }
        pending = {
          ...pending,
          initialized: {
            state: initialized.state,
            rng: initialized.rng,
          },
        };
        this.#pendingRound = pending;
      }

      const initialized = pending.initialized;
      if (initialized === null) {
        throw new Error("The pending round was not initialized.");
      }

      await dependencies.replayStore.create(pending.replayId, {
        replayFormatVersion: REPLAY_FORMAT_VERSION,
        gameId: aggregate.definition.manifest.id,
        gameVersion: aggregate.definition.manifest.gameVersion,
        rng: {
          algorithm: pending.initialRng.algorithm,
          seed: pending.initialRng.seed,
        },
        initialConfig: pending.config,
        players: pending.playerOrder.map((slotId) => {
          const assignment = pending.assignments.find(
            (entry) => entry.slotId === slotId,
          );
          return assignment?.assignment === null ||
            assignment?.assignment === undefined
            ? { slotId }
            : { slotId, assignment: assignment.assignment };
        }),
      });
      const storedRoom = this.#storedRoom(
        {
          replayId: pending.replayId,
          roundNumber: pending.roundNumber,
          playerOrder: pending.playerOrder,
          state: initialized.state,
          rng: initialized.rng,
          revision: 0,
          status: "active",
          outcome: null,
        },
        this.#closedReason,
        {
          initialConfig: pending.config,
          ...(aggregate.setupProtocol === SETUP_PROTOCOL_VERSION
            ? {
                nextRoundSetup: null,
                previousFinalizedSetup: pending.finalizedSetup,
              }
            : {}),
        },
      );
      await matchArchive.createRound(storedRoom);
      await dependencies.roomStore.save(storedRoom);

      aggregate.currentRound = {
        replayId: pending.replayId,
        roundNumber: pending.roundNumber,
        playerOrder: pending.playerOrder,
        state: initialized.state,
        rng: initialized.rng,
        revision: 0,
        status: "active",
        outcome: null,
      };
      aggregate.initialConfig = pending.config;
      if (aggregate.setupProtocol === SETUP_PROTOCOL_VERSION) {
        aggregate.nextRoundSetup = null;
        aggregate.previousFinalizedSetup = pending.finalizedSetup;
      }
      this.#pendingRound = null;
      if (aggregate.setupProtocol === PROTOCOL_VERSION) {
        this.#starterChoice = null;
        this.#readySessions.clear();
      }
      this.#terminalTimeout?.cancel();
      this.#terminalTimeout = null;
      logger.write({
        event: "room.round_started",
        roomId: this.roomId,
        ...this.#labels(),
        revision: 0,
        status: "active",
      });
    }

    async #expireDisconnectedSlot(slot: RuntimeSlot): Promise<void> {
      const aggregate = this.#requireAggregate();
      if (
        slot.reservedUntilMilliseconds === null ||
        slot.reservedUntilMilliseconds > dependencies.clock.nowMilliseconds() ||
        (aggregate.currentRound !== null &&
          aggregate.currentRound.status !== "active")
      ) {
        return;
      }
      slot.timeout = null;
      metrics.increment("reconnect_timeout_total", this.#labels());
      await this.#closeRoom("RECONNECT_TIMEOUT");
      logger.write({
        event: "connection.reconnect_timeout",
        roomId: this.roomId,
        ...this.#labels(),
        revision: aggregate.currentRound?.revision ?? 0,
        status: aggregate.currentRound?.status ?? "waiting",
        ...(slot.playerSessionId === null
          ? {}
          : {
              sessionCorrelationId: correlatePlayerSessionId(
                slot.playerSessionId,
              ),
            }),
      });
    }

    async #closeRoom(
      reason: RoomCloseReason,
      causingClient?: Client,
      causedByCommandId?: string,
      commandKey?: string,
    ): Promise<void> {
      if (this.#closedReason !== null || this.#disposed) {
        return;
      }
      const aggregate = this.#requireAggregate();
      const round = aggregate.currentRound;
      const shouldAbandon = round?.status === "active";
      const storedRoom = this.#storedRoom(
        shouldAbandon ? { status: "abandoned", outcome: null } : {},
        reason,
        aggregate.setupProtocol === SETUP_PROTOCOL_VERSION
          ? { nextRoundSetup: null }
          : {},
      );
      if (shouldAbandon) {
        await matchArchive.saveRound(storedRoom);
      }
      await dependencies.roomStore.save(storedRoom);
      if (shouldAbandon && round !== null) {
        round.status = "abandoned";
        round.outcome = null;
      }
      this.#closedReason = reason;
      this.#starterChoice = null;
      this.#readySessions.clear();
      this.#pendingRound = null;
      this.#pendingNextRoundSetup = null;
      if (aggregate.setupProtocol === SETUP_PROTOCOL_VERSION) {
        aggregate.nextRoundSetup = null;
      }
      this.#terminalTimeout?.cancel();
      this.#terminalTimeout = null;
      for (const slot of aggregate.slots) {
        slot.timeout?.cancel();
        slot.timeout = null;
        slot.reservedUntilMilliseconds = null;
      }
      if (
        causingClient !== undefined &&
        causedByCommandId !== undefined &&
        commandKey !== undefined
      ) {
        this.#commandOutcomes.set(
          commandKey,
          this.#lifecycleFor(causingClient, causedByCommandId),
        );
      }
      this.#broadcastLifecycle(causingClient, causedByCommandId);
      if (shouldAbandon) {
        this.#broadcastSnapshots();
      }
      logger.write({
        event: "room.closed",
        roomId: this.roomId,
        ...this.#labels(),
        revision: aggregate.currentRound?.revision ?? 0,
        status: aggregate.currentRound?.status ?? "waiting",
        closeReason: reason,
      });
      setTimeout(() => {
        if (!this.#disposed) {
          void this.disconnect(CloseCode.CONSENTED).catch(() => undefined);
        }
      }, 25);
    }

    #scheduleTerminalExpiry(): void {
      this.#terminalTimeout?.cancel();
      this.#terminalTimeout = dependencies.clock.setTimeout(() => {
        void this.#enqueue(() => this.#closeRoom("REMATCH_TIMEOUT"));
      }, terminalRoomTtl);
    }

    #allParticipantsReadyAndConnected(): boolean {
      const aggregate = this.#requireAggregate();
      const participants = aggregate.slots
        .map((slot) => slot.playerSessionId)
        .filter((session): session is string => session !== null);
      const assignmentCapability =
        aggregate.definition.manifest.capabilities.playerAssignment;
      const occupiedSlots = aggregate.slots.filter(
        (slot) => slot.playerSessionId !== null,
      );
      return (
        participants.length === aggregate.targetPlayerCount &&
        participants.every(
          (session) =>
            this.#activeClientBySession.has(session) &&
            this.#readySessions.has(session),
        ) &&
        (assignmentCapability === undefined ||
          (occupiedSlots.length === aggregate.targetPlayerCount &&
            occupiedSlots.every((slot) => slot.assignment !== null) &&
            new Set(occupiedSlots.map((slot) => slot.assignment)).size ===
              occupiedSlots.length))
      );
    }

    #allParticipantsConnected(): boolean {
      const aggregate = this.#requireAggregate();
      const participants = aggregate.slots
        .map((slot) => slot.playerSessionId)
        .filter((session): session is string => session !== null);
      return (
        participants.length === aggregate.targetPlayerCount &&
        participants.every((session) =>
          this.#activeClientBySession.has(session),
        )
      );
    }

    #setupSlots(): readonly SetupSlot[] {
      const aggregate = this.#requireAggregate();
      return aggregate.slots.map((slot) => ({
        slotId: slot.slotId,
        occupied: slot.playerSessionId !== null,
        online:
          slot.playerSessionId !== null &&
          this.#activeClientBySession.has(slot.playerSessionId),
        isOwner: slot.playerSessionId === this.#creatorSessionId,
      }));
    }

    #clearReadyForSlot(slotId: string): boolean {
      const aggregate = this.#requireAggregate();
      if (
        aggregate.setupProtocol === SETUP_PROTOCOL_VERSION &&
        aggregate.setupDefinition !== null &&
        aggregate.nextRoundSetup !== null
      ) {
        const result = setRoundSetupReady(
          aggregate.setupDefinition,
          aggregate.nextRoundSetup,
          this.#setupSlots(),
          slotId,
          false,
        );
        if (result.status !== "rejected") {
          const changed = result.coordinator !== aggregate.nextRoundSetup;
          aggregate.nextRoundSetup = result.coordinator;
          return changed;
        }
        return false;
      }
      const slot = aggregate.slots.find(
        (candidate) => candidate.slotId === slotId,
      );
      if (
        slot?.playerSessionId !== null &&
        slot?.playerSessionId !== undefined
      ) {
        return this.#readySessions.delete(slot.playerSessionId);
      }
      return false;
    }

    #createNextRoundSetupCandidate(): RoundSetupCoordinatorState {
      if (this.#pendingNextRoundSetup !== null) {
        return this.#pendingNextRoundSetup;
      }
      const aggregate = this.#requireAggregate();
      if (
        aggregate.setupDefinition === null ||
        aggregate.previousFinalizedSetup === null
      ) {
        throw new Error("Previous finalized setup is unavailable.");
      }
      const candidate = initializeRoundSetupCoordinator(
        aggregate.setupDefinition,
        {
          source: {
            kind: "previous-round",
            setup: aggregate.previousFinalizedSetup,
          },
          slots: this.#setupSlots(),
        },
        createSetupRng(ids.createRngSeed()),
      );
      this.#pendingNextRoundSetup = candidate;
      return candidate;
    }

    #v6SetupReadyToStart(): boolean {
      const aggregate = this.#requireAggregate();
      const definition = aggregate.setupDefinition;
      const coordinator = aggregate.nextRoundSetup;
      if (
        definition === null ||
        coordinator === null ||
        coordinator.finalizedSetup === null
      ) {
        return false;
      }
      const readiness = getRoundSetupReadiness(
        definition,
        coordinator,
        this.#setupSlots(),
      );
      return (
        readiness.canFinalize &&
        readiness.requiredSlotIds.every((slotId) =>
          readiness.readySlotIds.includes(slotId),
        )
      );
    }

    #playerAssignmentsFor(pending: PendingRound): {
      readonly playerAssignments?: readonly string[];
    } {
      const assignments = pending.playerOrder.map((slotId) =>
        pending.assignments.find((entry) => entry.slotId === slotId),
      );
      if (assignments.some((entry) => entry === undefined)) {
        throw new Error("Every player needs an assignment entry.");
      }
      const values = assignments.map((entry) => entry?.assignment ?? null);
      if (values.every((value) => value === null)) {
        return {};
      }
      if (values.some((value) => value === null)) {
        throw new Error(
          "Player assignments cannot mix null and string values.",
        );
      }
      return { playerAssignments: values as readonly string[] };
    }

    #enqueue(work: () => void | Promise<void>): Promise<void> {
      const result = this.#queue.then(work, work);
      this.#queue = result.catch(() => undefined);
      return result;
    }

    #sendCommandOutcome(client: Client, outcome: RuntimeCommandOutcome): void {
      client.send(
        outcome.type === "room.lifecycle"
          ? ROOM_CONTROL_MESSAGE
          : SERVER_PROTOCOL_MESSAGE,
        outcome,
      );
    }

    #rejectControlAndCache(
      client: Client,
      commandKey: string,
      code: ProtocolErrorCode,
      commandId: string,
    ): void {
      const rejection = this.#rejection(code, commandId);
      this.#commandOutcomes.set(commandKey, rejection);
      client.send(SERVER_PROTOCOL_MESSAGE, rejection);
      const clientData = client.userData as RuntimeClientData | undefined;
      logger.write({
        event: "room.control_rejected",
        roomId: this.roomId,
        ...this.#labels(),
        revision: this.#requireAggregate().currentRound?.revision ?? 0,
        code,
        ...(clientData === undefined
          ? {}
          : {
              sessionCorrelationId: correlatePlayerSessionId(
                clientData.playerSessionId,
              ),
            }),
      });
    }

    async #createUniqueRoomCode(): Promise<string> {
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const roomCode = ids.createRoomCode().trim().toUpperCase();
        if (
          /^[A-HJ-NP-Z2-9]{8}$/u.test(roomCode) &&
          (await dependencies.roomStore.getByRoomCode(roomCode)) === null
        ) {
          return roomCode;
        }
      }
      throw new ServerError(500, "INTERNAL_ERROR");
    }

    #clientSession(client: Client): string {
      const auth = client.auth as
        { readonly playerSessionId?: unknown } | undefined;
      if (
        auth === undefined ||
        typeof auth.playerSessionId !== "string" ||
        auth.playerSessionId.length === 0
      ) {
        throw protocolServerError("UNAUTHENTICATED");
      }
      return auth.playerSessionId;
    }

    #clientUserId(client: Client): string | null {
      const auth = client.auth as { readonly userId?: unknown } | undefined;
      if (auth?.userId === null) return null;
      if (
        typeof auth?.userId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          auth.userId,
        )
      ) {
        throw protocolServerError("UNAUTHENTICATED");
      }
      return auth.userId;
    }

    #labels(): Required<MetricLabels> {
      const manifest = this.#requireAggregate().definition.manifest;
      return {
        gameId: manifest.id,
        gameVersion: manifest.gameVersion,
      };
    }

    #requestProtocolCode(
      input: unknown,
      fallback: ProtocolErrorCode,
      expectedProtocol?: SetupProtocolGeneration,
    ): ProtocolErrorCode {
      if (
        input !== null &&
        typeof input === "object" &&
        "protocolVersion" in input &&
        (expectedProtocol === undefined
          ? requestedProtocolVersion(input) !== PROTOCOL_VERSION &&
            requestedProtocolVersion(input) !== SETUP_PROTOCOL_VERSION
          : requestedProtocolVersion(input) !== expectedProtocol)
      ) {
        return "PROTOCOL_VERSION_UNSUPPORTED";
      }
      return fallback;
    }

    #rejectAndCache(
      client: Client,
      commandKey: string,
      code: ProtocolErrorCode,
      commandId: string,
      snapshot?: MatchSnapshot | MatchSnapshotV6,
      gameRuleCode?: string,
    ): void {
      const rejection = this.#rejection(
        code,
        commandId,
        snapshot,
        gameRuleCode,
      );
      this.#commandOutcomes.set(commandKey, rejection);
      client.send(SERVER_PROTOCOL_MESSAGE, rejection);
      metrics.increment("actions_rejected_total", this.#labels());
      const clientData = client.userData as RuntimeClientData | undefined;
      logger.write({
        event: "action.rejected",
        roomId: this.roomId,
        ...this.#labels(),
        revision: this.#requireAggregate().currentRound?.revision ?? 0,
        code,
        ...(clientData === undefined
          ? {}
          : {
              sessionCorrelationId: correlatePlayerSessionId(
                clientData.playerSessionId,
              ),
            }),
      });
    }

    #rejectSetupAndCache(
      client: Client,
      commandKey: string,
      code: ProtocolErrorCode,
      commandId: string,
      setupRevision?: number,
      gameRuleCode?: string,
    ): void {
      const rejection = this.#rejection(
        code,
        commandId,
        undefined,
        gameRuleCode,
        setupRevision,
      );
      this.#commandOutcomes.set(commandKey, rejection);
      client.send(SERVER_PROTOCOL_MESSAGE, rejection);
      metrics.increment("actions_rejected_total", this.#labels());
      const clientData = client.userData as RuntimeClientData | undefined;
      logger.write({
        event: "game.setup_rejected",
        roomId: this.roomId,
        ...this.#labels(),
        revision: this.#requireAggregate().currentRound?.revision ?? 0,
        code,
        ...(clientData === undefined
          ? {}
          : {
              sessionCorrelationId: correlatePlayerSessionId(
                clientData.playerSessionId,
              ),
            }),
      });
    }

    #sendRejection(
      client: Client,
      code: ProtocolErrorCode,
      commandId?: string,
    ): void {
      client.send(SERVER_PROTOCOL_MESSAGE, this.#rejection(code, commandId));
      const aggregate = this.#aggregate;
      if (aggregate !== undefined) {
        metrics.increment("actions_rejected_total", this.#labels());
      }
    }

    #rejection(
      code: ProtocolErrorCode,
      commandId?: string,
      snapshot?: MatchSnapshot | MatchSnapshotV6,
      gameRuleCode?: string,
      setupRevision?: number,
    ): CommandRejected | CommandRejectedV6 {
      const aggregate = this.#aggregate;
      const shared = {
        type: "command.rejected" as const,
        ...(commandId === undefined ? {} : { commandId }),
        code,
        ...(aggregate?.currentRound === undefined ||
        aggregate.currentRound === null
          ? {}
          : { revision: aggregate.currentRound.revision }),
        ...(gameRuleCode === undefined ? {} : { gameRuleCode }),
        retryable: retryable(code),
        ...(snapshot === undefined ? {} : { snapshot }),
      };
      if (aggregate?.setupProtocol === SETUP_PROTOCOL_VERSION) {
        return {
          ...shared,
          protocolVersion: SETUP_PROTOCOL_VERSION,
          ...(setupRevision === undefined ? {} : { setupRevision }),
        } as CommandRejectedV6;
      }
      return {
        ...shared,
        protocolVersion: PROTOCOL_VERSION,
      } as CommandRejected;
    }

    #sendConnected(client: Client, slotId: PlayerSlotId): void {
      const aggregate = this.#requireAggregate();
      const shared = {
        type: "room.connected" as const,
        roomCode: aggregate.roomCode,
        gameId: aggregate.definition.manifest.id,
        gameVersion: aggregate.definition.manifest.gameVersion,
        playerSlotId: slotId,
      };
      const message: RoomConnected | RoomConnectedV6 =
        aggregate.setupProtocol === SETUP_PROTOCOL_VERSION
          ? { ...shared, protocolVersion: SETUP_PROTOCOL_VERSION }
          : { ...shared, protocolVersion: PROTOCOL_VERSION };
      client.send(SERVER_PROTOCOL_MESSAGE, message);
    }

    #broadcastLifecycle(
      causingClient?: Client,
      causedByCommandId?: string,
    ): void {
      for (const client of this.clients) {
        const clientData = client.userData as RuntimeClientData | undefined;
        if (
          clientData !== undefined &&
          this.#activeClientBySession.get(clientData.playerSessionId) === client
        ) {
          client.send(
            ROOM_CONTROL_MESSAGE,
            this.#lifecycleFor(
              client,
              client === causingClient ? causedByCommandId : undefined,
            ),
          );
        }
      }
    }

    #lifecycleFor(
      client: Client,
      causedByCommandId?: string,
    ): RoomLifecycleState | RoomLifecycleStateV6 {
      const aggregate = this.#requireAggregate();
      const clientData = client.userData as RuntimeClientData | undefined;
      if (clientData === undefined) {
        throw protocolServerError("NOT_A_PLAYER");
      }
      const currentRound = aggregate.currentRound;
      const available =
        this.#closedReason === null &&
        (currentRound === null || currentRound.status === "completed");
      if (aggregate.setupProtocol === SETUP_PROTOCOL_VERSION) {
        const definition = aggregate.setupDefinition;
        const coordinator = aggregate.nextRoundSetup;
        if (available && (definition === null || coordinator === null)) {
          throw new ServerError(500, "INTERNAL_ERROR");
        }
        let nextRound: RoomLifecycleStateV6["nextRound"] = null;
        if (available && definition !== null && coordinator !== null) {
          let setupView: SetupJsonValue;
          try {
            setupView = projectRoundSetupView(
              definition,
              coordinator,
              this.#setupSlots(),
              { kind: "player", slotId: clientData.slotId },
            );
          } catch {
            throw new ServerError(500, "INTERNAL_ERROR");
          }
          const readiness = getRoundSetupReadiness(
            definition,
            coordinator,
            this.#setupSlots(),
            clientData.slotId,
          );
          nextRound = {
            roundNumber: (currentRound?.roundNumber ?? 0) + 1,
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
        const readySlotIds = new Set(
          coordinator?.readySlotIds ?? ([] as readonly string[]),
        );
        return {
          type: "room.lifecycle",
          protocolVersion: SETUP_PROTOCOL_VERSION,
          isOwner: clientData.playerSessionId === this.#creatorSessionId,
          currentRound:
            currentRound === null
              ? null
              : {
                  roundNumber: currentRound.roundNumber,
                  status: currentRound.status,
                },
          nextRound,
          players: aggregate.slots.map((slot) => ({
            slotId: slot.slotId,
            occupied: slot.playerSessionId !== null,
            online:
              slot.playerSessionId !== null &&
              this.#activeClientBySession.has(slot.playerSessionId),
            ready: readySlotIds.has(slot.slotId),
          })),
          closed: this.#closedReason !== null,
          closeReason: this.#closedReason,
          ...(causedByCommandId === undefined ? {} : { causedByCommandId }),
        };
      }
      return {
        type: "room.lifecycle",
        protocolVersion: PROTOCOL_VERSION,
        isOwner: clientData.playerSessionId === this.#creatorSessionId,
        currentRound:
          currentRound === null
            ? null
            : {
                roundNumber: currentRound.roundNumber,
                status: currentRound.status,
              },
        nextRound: available
          ? {
              roundNumber: (currentRound?.roundNumber ?? 0) + 1,
              starter: this.#starterChoice,
              selfReady: this.#readySessions.has(clientData.playerSessionId),
              readyPlayerCount: this.#readySessions.size,
              requiredPlayerCount: aggregate.targetPlayerCount,
              ...(aggregate.definition.manifest.capabilities
                .playerAssignment === undefined
                ? {}
                : {
                    assignmentOptions: [
                      ...aggregate.definition.manifest.capabilities
                        .playerAssignment.options,
                    ],
                  }),
            }
          : null,
        players: aggregate.slots.map((slot) => ({
          slotId: slot.slotId,
          occupied: slot.playerSessionId !== null,
          online:
            slot.playerSessionId !== null &&
            this.#activeClientBySession.has(slot.playerSessionId),
          ready:
            slot.playerSessionId !== null &&
            this.#readySessions.has(slot.playerSessionId),
          assignment: slot.assignment,
        })),
        closed: this.#closedReason !== null,
        closeReason: this.#closedReason,
        ...(causedByCommandId === undefined ? {} : { causedByCommandId }),
      };
    }

    #sendSnapshot(client: Client, causedByCommandId?: string): void {
      client.send(
        SERVER_PROTOCOL_MESSAGE,
        this.#snapshotFor(client, causedByCommandId),
      );
    }

    #broadcastSnapshots(
      causingClient?: Client,
      causedByCommandId?: string,
    ): void {
      for (const client of this.clients) {
        const clientData = client.userData as RuntimeClientData | undefined;
        if (
          clientData !== undefined &&
          this.#activeClientBySession.get(clientData.playerSessionId) === client
        ) {
          this.#sendSnapshot(
            client,
            client === causingClient ? causedByCommandId : undefined,
          );
        }
      }
    }

    #snapshotFor(
      client: Client,
      causedByCommandId?: string,
    ):
      | MatchSnapshot<JsonValue, JsonValue>
      | MatchSnapshotV6<JsonValue, JsonValue> {
      const aggregate = this.#requireAggregate();
      const round = aggregate.currentRound;
      if (round === null) {
        throw protocolServerError("MATCH_NOT_ACTIVE");
      }
      const clientData = client.userData as RuntimeClientData | undefined;
      if (clientData === undefined) {
        throw protocolServerError("NOT_A_PLAYER");
      }
      const viewer = { kind: "player", slotId: clientData.slotId } as const;
      let view: JsonValue;
      try {
        view = aggregate.definition.projectView({
          state: round.state,
          viewer,
        });
      } catch {
        throw new ServerError(500, "INTERNAL_ERROR");
      }
      if (!isJsonValue(view)) {
        throw new ServerError(500, "INTERNAL_ERROR");
      }
      const shared = {
        type: "match.snapshot",
        gameId: aggregate.definition.manifest.id,
        gameVersion: aggregate.definition.manifest.gameVersion,
        roundNumber: round.roundNumber,
        revision: round.revision,
        status: round.status,
        viewer,
        view,
        outcome: round.outcome,
        ...(causedByCommandId === undefined ? {} : { causedByCommandId }),
      };
      return aggregate.setupProtocol === SETUP_PROTOCOL_VERSION
        ? {
            ...shared,
            type: "match.snapshot" as const,
            protocolVersion: SETUP_PROTOCOL_VERSION,
          }
        : {
            ...shared,
            type: "match.snapshot" as const,
            protocolVersion: PROTOCOL_VERSION,
          };
    }

    #roomCrash(client: Client, commandId?: string): void {
      metrics.increment("room_crash_total", this.#labels());
      client.send(
        SERVER_PROTOCOL_MESSAGE,
        this.#rejection("INTERNAL_ERROR", commandId),
      );
      logger.write({
        event: "room.crashed",
        roomId: this.roomId,
        ...this.#labels(),
        revision: this.#requireAggregate().currentRound?.revision ?? 0,
        code: "ROOM_CRASH",
      });
    }

    #storedRoom(
      candidate: Partial<StoredGameRound> = {},
      closeReason: RoomCloseReason | null = this.#closedReason,
      setupOverrides: {
        readonly initialConfig?: JsonValue;
        readonly nextRoundSetup?: RoundSetupCoordinatorState | null;
        readonly previousFinalizedSetup?: FinalizedRoundSetup | null;
      } = {},
    ): StoredGameRoom {
      const aggregate = this.#requireAggregate();
      const players: StoredPlayerSlot[] = aggregate.slots.map((slot) => ({
        slotId: slot.slotId,
        playerSessionId: slot.playerSessionId,
        userId: slot.userId ?? null,
        reservedUntilMilliseconds: slot.reservedUntilMilliseconds,
        ...(slot.assignment === null ? {} : { assignment: slot.assignment }),
      }));
      const round = aggregate.currentRound;
      const replayId = candidate.replayId ?? round?.replayId;
      let currentRound: StoredGameRound | null = null;
      if (replayId !== undefined) {
        const roundNumber = candidate.roundNumber ?? round?.roundNumber;
        const playerOrder = candidate.playerOrder ?? round?.playerOrder;
        const state = candidate.state ?? round?.state;
        const rng = candidate.rng ?? round?.rng;
        const revision = candidate.revision ?? round?.revision;
        const status = candidate.status ?? round?.status;
        const outcome =
          candidate.outcome === undefined ? round?.outcome : candidate.outcome;
        if (
          roundNumber === undefined ||
          playerOrder === undefined ||
          state === undefined ||
          rng === undefined ||
          revision === undefined ||
          status === undefined ||
          outcome === undefined
        ) {
          throw new Error("A stored round candidate is incomplete.");
        }
        currentRound = {
          replayId,
          roundNumber,
          playerOrder,
          state,
          rng,
          revision,
          status,
          outcome,
        };
      }
      const nextRoundSetup =
        "nextRoundSetup" in setupOverrides
          ? (setupOverrides.nextRoundSetup ?? null)
          : aggregate.nextRoundSetup;
      const previousFinalizedSetup =
        "previousFinalizedSetup" in setupOverrides
          ? (setupOverrides.previousFinalizedSetup ?? null)
          : aggregate.previousFinalizedSetup;
      return {
        roomId: this.roomId,
        roomCode: aggregate.roomCode,
        gameId: aggregate.definition.manifest.id,
        gameVersion: aggregate.definition.manifest.gameVersion,
        setupProtocol: aggregate.setupProtocol,
        initialConfig: setupOverrides.initialConfig ?? aggregate.initialConfig,
        players,
        currentRound,
        ...(nextRoundSetup === null ? {} : { nextRoundSetup }),
        ...(previousFinalizedSetup === null ? {} : { previousFinalizedSetup }),
        closeReason,
      };
    }

    #requireAggregate(): RuntimeAggregate {
      if (this.#aggregate === undefined) {
        throw new Error("Authoritative room is not initialized.");
      }
      return this.#aggregate;
    }
  };
}
