import { Room, ServerError } from "@colyseus/core";
import type { Client } from "@colyseus/core";
import { REPLAY_FORMAT_VERSION, type ReplayStore } from "./replay.js";
import {
  RNG_ALGORITHM_V1,
  createRng,
  isJsonValue,
} from "@online-game-hub/game-sdk";
import type {
  JsonValue,
  PlayerSlotId,
  RngState,
  UnknownGameDefinition,
} from "@online-game-hub/game-sdk";
import {
  PROTOCOL_VERSION,
  createGameRoomRequestSchema,
  gameActionCommandSchema,
  gameRoomRequestSchema,
} from "@online-game-hub/protocol";
import type {
  CommandRejected,
  MatchSnapshot,
  MatchStatus,
  ProtocolErrorCode,
  RoomConnected,
  ServerMessage,
} from "@online-game-hub/protocol";

import type { TicketVerifier } from "./auth.js";
import type { CancelTimer, RuntimeClock } from "./clock.js";
import type { RuntimeIdSource } from "./ids.js";
import { secureRuntimeIdSource } from "./ids.js";
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
  StoredGameRoom,
  StoredPlayerSlot,
} from "./room-store.js";

export const GAME_ROOM_NAME = "game" as const;
export const GAME_ACTION_MESSAGE = "game.action" as const;
export const SERVER_PROTOCOL_MESSAGE = "protocol" as const;
export const DEFAULT_RECONNECT_GRACE_MILLISECONDS = 60_000;

export type CurrentGameDefinitionResolver = (
  gameId: string,
) => UnknownGameDefinition | undefined;
export type ExactGameDefinitionResolver = (
  gameId: string,
  gameVersion: string,
) => UnknownGameDefinition | undefined;

export interface AuthoritativeGameRoomDependencies {
  readonly ticketVerifier: TicketVerifier;
  readonly resolveCurrentDefinition: CurrentGameDefinitionResolver;
  readonly resolveDefinition: ExactGameDefinitionResolver;
  readonly roomStore: RoomStore;
  readonly replayStore: ReplayStore;
  readonly clock: RuntimeClock;
  readonly ids?: RuntimeIdSource;
  readonly metrics?: MetricsCollector;
  readonly logger?: RuntimeLogger;
  readonly reconnectGraceMilliseconds?: number;
}

export interface GameRoomMetadata {
  readonly roomCode: string;
  readonly gameId: string;
  readonly gameVersion: string;
}

export type AuthoritativeGameRoomClass = new () => Room<{
  metadata: GameRoomMetadata;
}>;

interface RuntimeSlot {
  readonly slotId: PlayerSlotId;
  playerSessionId: string | null;
  reservedUntilMilliseconds: number | null;
  timeout: CancelTimer | null;
}

interface RuntimeAggregate {
  readonly definition: UnknownGameDefinition;
  readonly initialConfig: JsonValue;
  readonly replayId: string;
  readonly roomCode: string;
  readonly slots: RuntimeSlot[];
  state: JsonValue;
  rng: RngState;
  revision: number;
  status: MatchStatus;
  outcome: JsonValue | null;
}

interface RuntimeClientData {
  readonly playerSessionId: string;
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
  return code === "STALE_REVISION" || code === "RATE_LIMITED";
}

export function createAuthoritativeGameRoomClass(
  dependencies: AuthoritativeGameRoomDependencies,
): AuthoritativeGameRoomClass {
  const ids = dependencies.ids ?? secureRuntimeIdSource;
  const metrics = dependencies.metrics ?? new InMemoryMetricsCollector();
  const logger = dependencies.logger ?? noopRuntimeLogger;
  const reconnectGrace =
    dependencies.reconnectGraceMilliseconds ??
    DEFAULT_RECONNECT_GRACE_MILLISECONDS;
  if (!Number.isSafeInteger(reconnectGrace) || reconnectGrace < 0) {
    throw new RangeError("Reconnect grace must be a non-negative integer.");
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
    readonly #commandOutcomes = new Map<string, ServerMessage>();
    #disposed = false;

    public static override async onAuth(
      _token: string,
      options: unknown,
    ): Promise<{ readonly playerSessionId: string }> {
      const request = gameRoomRequestSchema.safeParse(options);
      if (!request.success) {
        const unsupported =
          options !== null &&
          typeof options === "object" &&
          "protocolVersion" in options &&
          (options as { readonly protocolVersion?: unknown })
            .protocolVersion !== PROTOCOL_VERSION;
        throw protocolServerError(
          unsupported
            ? "PROTOCOL_VERSION_UNSUPPORTED"
            : "INVALID_ACTION_PAYLOAD",
        );
      }
      const verification = await dependencies.ticketVerifier.verify(
        request.data.ticket,
      );
      if (verification.status === "rejected") {
        throw protocolServerError(verification.protocolCode);
      }
      return { playerSessionId: verification.playerSessionId };
    }

    public override async onCreate(options: unknown): Promise<void> {
      const request = createGameRoomRequestSchema.safeParse(options);
      if (!request.success || !isJsonValue(request.data.initialConfig)) {
        throw protocolServerError(
          this.#requestProtocolCode(options, "INVALID_ACTION_PAYLOAD"),
        );
      }
      const verification = await dependencies.ticketVerifier.verify(
        request.data.ticket,
      );
      if (verification.status === "rejected") {
        throw protocolServerError(verification.protocolCode);
      }

      const definition = dependencies.resolveCurrentDefinition(
        request.data.gameId,
      );
      if (definition === undefined) {
        throw protocolServerError("ROOM_NOT_FOUND");
      }
      const configResult = definition.configSchema.safeParse(
        request.data.initialConfig,
      );
      if (!configResult.success || !isJsonValue(configResult.data)) {
        throw protocolServerError("INVALID_ACTION_PAYLOAD");
      }
      const { minPlayers, maxPlayers } = definition.manifest;
      if (
        !Number.isSafeInteger(minPlayers) ||
        !Number.isSafeInteger(maxPlayers) ||
        minPlayers <= 0 ||
        maxPlayers < minPlayers
      ) {
        throw new ServerError(500, "INTERNAL_ERROR");
      }

      const roomCode = await this.#createUniqueRoomCode();
      const slots = Array.from({ length: maxPlayers }, (_, index) => ({
        slotId: ids.createPlayerSlotId(index),
        playerSessionId: index === 0 ? verification.playerSessionId : null,
        reservedUntilMilliseconds: null,
        timeout: null,
      }));
      if (new Set(slots.map((slot) => slot.slotId)).size !== slots.length) {
        throw new ServerError(500, "INTERNAL_ERROR");
      }

      const initialRng = createRng(ids.createRngSeed());
      let initialized: ReturnType<UnknownGameDefinition["createInitialState"]>;
      try {
        initialized = definition.createInitialState({
          config: configResult.data,
          players: slots.map((slot) => slot.slotId),
          rng: initialRng,
        });
      } catch {
        throw new ServerError(500, "INTERNAL_ERROR");
      }
      if (
        !isJsonValue(initialized.state) ||
        !validReturnedRng(initialized.rng, initialRng)
      ) {
        throw new ServerError(500, "INTERNAL_ERROR");
      }

      this.autoDispose = false;
      this.patchRate = null;
      this.maxClients = maxPlayers * 2;
      this.maxMessagesPerSecond = 30;
      const replayId = ids.createReplayId();
      this.#creatorSessionId = verification.playerSessionId;
      this.#aggregate = {
        definition,
        initialConfig: configResult.data,
        replayId,
        roomCode,
        slots,
        state: initialized.state,
        rng: initialized.rng,
        revision: 0,
        status: "waiting",
        outcome: null,
      };

      await dependencies.replayStore.create(replayId, {
        replayFormatVersion: REPLAY_FORMAT_VERSION,
        gameId: definition.manifest.id,
        gameVersion: definition.manifest.gameVersion,
        rng: {
          algorithm: initialRng.algorithm,
          seed: initialRng.seed,
        },
        initialConfig: configResult.data,
        players: slots.map((slot) => ({ slotId: slot.slotId })),
      });
      await dependencies.roomStore.create(this.#storedRoom());
      await this.setMetadata({
        roomCode,
        gameId: definition.manifest.id,
        gameVersion: definition.manifest.gameVersion,
      });

      const labels = this.#labels();
      adjustGauge("active_rooms", 1, labels);
      this.onMessage(GAME_ACTION_MESSAGE, (client, message: unknown) =>
        this.#enqueue(() => this.#handleAction(client, message)),
      );
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
        const request = gameRoomRequestSchema.safeParse(options);
        if (!request.success) {
          throw protocolServerError(
            this.#requestProtocolCode(options, "INVALID_ACTION_PAYLOAD"),
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
          request.data.type === "room.create"
            ? playerSessionId !== this.#creatorSessionId ||
              request.data.gameId !== aggregate.definition.manifest.id
            : request.data.roomCode !== aggregate.roomCode
        ) {
          throw protocolServerError("NOT_A_PLAYER");
        }
        if (aggregate.status === "abandoned") {
          throw protocolServerError("MATCH_NOT_ACTIVE");
        }

        let slot = aggregate.slots.find(
          (candidate) => candidate.playerSessionId === playerSessionId,
        );
        if (slot === undefined) {
          if (request.data.type !== "room.join") {
            throw protocolServerError("NOT_A_PLAYER");
          }
          slot = aggregate.slots.find(
            (candidate) => candidate.playerSessionId === null,
          );
          if (slot === undefined || aggregate.status !== "waiting") {
            throw protocolServerError("ROOM_FULL");
          }
          slot.playerSessionId = playerSessionId;
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
        this.#activeClientBySession.set(playerSessionId, client);
        const clientData: RuntimeClientData = {
          playerSessionId,
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

        const becameActive =
          aggregate.status === "waiting" && this.#allRequiredPlayersConnected();
        if (becameActive) {
          aggregate.status = "active";
        }
        await dependencies.roomStore.save(this.#storedRoom());
        this.#sendConnected(client, slot.slotId);
        if (becameActive) {
          this.#broadcastSnapshots();
        } else {
          this.#sendSnapshot(client);
        }
        logger.write({
          event: wasReconnect ? "connection.reconnected" : "connection.joined",
          roomId: this.roomId,
          ...this.#labels(),
          revision: aggregate.revision,
          status: aggregate.status,
          sessionCorrelationId: correlatePlayerSessionId(playerSessionId),
        });
      });
    }

    public override async onLeave(client: Client): Promise<void> {
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
        const aggregate = this.#requireAggregate();
        if (
          aggregate.status === "completed" ||
          aggregate.status === "abandoned" ||
          this.#disposed
        ) {
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
        await dependencies.roomStore.save(this.#storedRoom());
        logger.write({
          event: "connection.left",
          roomId: this.roomId,
          ...this.#labels(),
          revision: aggregate.revision,
          status: aggregate.status,
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
      adjustGauge("active_rooms", -1, this.#labels());
    }

    public override onUncaughtException(): void {
      const aggregate = this.#aggregate;
      metrics.increment(
        "room_crash_total",
        aggregate === undefined ? {} : this.#labels(),
      );
      logger.write({
        event: "room.crashed",
        roomId: this.roomId,
        ...(aggregate === undefined ? {} : this.#labels()),
        ...(aggregate === undefined ? {} : { revision: aggregate.revision }),
        code: "ROOM_CRASH",
      });
    }

    async #handleAction(client: Client, rawMessage: unknown): Promise<void> {
      const parsed = gameActionCommandSchema.safeParse(rawMessage);
      if (!parsed.success) {
        this.#sendRejection(
          client,
          this.#requestProtocolCode(rawMessage, "INVALID_ACTION_PAYLOAD"),
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
        client.send(SERVER_PROTOCOL_MESSAGE, duplicate);
        return;
      }

      const aggregate = this.#requireAggregate();
      if (aggregate.status !== "active") {
        this.#rejectAndCache(
          client,
          commandKey,
          "MATCH_NOT_ACTIVE",
          command.commandId,
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
        this.#rejectAndCache(
          client,
          commandKey,
          "NOT_A_PLAYER",
          command.commandId,
        );
        return;
      }
      if (command.expectedRevision !== aggregate.revision) {
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
          state: aggregate.state,
          actorSlotId: slot.slotId,
          action: actionResult.data,
          rng: aggregate.rng,
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
        !validReturnedRng(transitioned.rng, aggregate.rng)
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

      const nextRevision = aggregate.revision + 1;
      try {
        await dependencies.replayStore.append(
          aggregate.replayId,
          aggregate.revision,
          {
            sequence: nextRevision,
            actorSlotId: slot.slotId,
            action: actionResult.data,
          },
        );
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

      aggregate.state = transitioned.state;
      aggregate.rng = transitioned.rng;
      aggregate.revision = nextRevision;
      aggregate.outcome = outcome;
      if (outcome !== null) {
        aggregate.status = "completed";
      }
      try {
        await dependencies.roomStore.save(this.#storedRoom());
        if (outcome !== null) {
          await dependencies.replayStore.complete(
            aggregate.replayId,
            nextRevision,
            transitioned.rng.cursor,
            outcome,
          );
        }
      } catch {
        this.#roomCrash(client, command.commandId);
        return;
      }

      metrics.increment("actions_accepted_total", this.#labels());
      const result = this.#snapshotFor(client, command.commandId);
      this.#commandOutcomes.set(commandKey, result);
      this.#broadcastSnapshots(client, command.commandId);
      logger.write({
        event: "action.accepted",
        roomId: this.roomId,
        ...this.#labels(),
        revision: aggregate.revision,
        status: aggregate.status,
        sessionCorrelationId: correlatePlayerSessionId(
          clientData.playerSessionId,
        ),
      });
    }

    async #expireDisconnectedSlot(slot: RuntimeSlot): Promise<void> {
      const aggregate = this.#requireAggregate();
      if (
        slot.reservedUntilMilliseconds === null ||
        slot.reservedUntilMilliseconds > dependencies.clock.nowMilliseconds() ||
        (aggregate.status !== "waiting" && aggregate.status !== "active")
      ) {
        return;
      }
      slot.timeout = null;
      aggregate.status = "abandoned";
      metrics.increment("reconnect_timeout_total", this.#labels());
      await dependencies.roomStore.save(this.#storedRoom());
      this.#broadcastSnapshots();
      logger.write({
        event: "connection.reconnect_timeout",
        roomId: this.roomId,
        ...this.#labels(),
        revision: aggregate.revision,
        status: aggregate.status,
        ...(slot.playerSessionId === null
          ? {}
          : {
              sessionCorrelationId: correlatePlayerSessionId(
                slot.playerSessionId,
              ),
            }),
      });
    }

    #enqueue(work: () => void | Promise<void>): Promise<void> {
      const result = this.#queue.then(work, work);
      this.#queue = result.catch(() => undefined);
      return result;
    }

    #allRequiredPlayersConnected(): boolean {
      const aggregate = this.#requireAggregate();
      const required = aggregate.definition.manifest.minPlayers;
      return (
        aggregate.slots.filter(
          (slot) =>
            slot.playerSessionId !== null &&
            this.#activeClientBySession.has(slot.playerSessionId),
        ).length >= required
      );
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
    ): ProtocolErrorCode {
      if (
        input !== null &&
        typeof input === "object" &&
        "protocolVersion" in input &&
        (input as { readonly protocolVersion?: unknown }).protocolVersion !==
          PROTOCOL_VERSION
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
      snapshot?: MatchSnapshot,
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
        revision: this.#requireAggregate().revision,
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
      snapshot?: MatchSnapshot,
      gameRuleCode?: string,
    ): CommandRejected {
      const aggregate = this.#aggregate;
      return {
        type: "command.rejected",
        protocolVersion: PROTOCOL_VERSION,
        ...(commandId === undefined ? {} : { commandId }),
        code,
        ...(aggregate === undefined ? {} : { revision: aggregate.revision }),
        ...(gameRuleCode === undefined ? {} : { gameRuleCode }),
        retryable: retryable(code),
        ...(snapshot === undefined ? {} : { snapshot }),
      };
    }

    #sendConnected(client: Client, slotId: PlayerSlotId): void {
      const aggregate = this.#requireAggregate();
      const message: RoomConnected = {
        type: "room.connected",
        protocolVersion: PROTOCOL_VERSION,
        roomCode: aggregate.roomCode,
        gameId: aggregate.definition.manifest.id,
        gameVersion: aggregate.definition.manifest.gameVersion,
        playerSlotId: slotId,
      };
      client.send(SERVER_PROTOCOL_MESSAGE, message);
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
    ): MatchSnapshot<JsonValue, JsonValue> {
      const aggregate = this.#requireAggregate();
      const clientData = client.userData as RuntimeClientData | undefined;
      if (clientData === undefined) {
        throw protocolServerError("NOT_A_PLAYER");
      }
      const viewer = { kind: "player", slotId: clientData.slotId } as const;
      let view: JsonValue;
      try {
        view = aggregate.definition.projectView({
          state: aggregate.state,
          viewer,
        });
      } catch {
        throw new ServerError(500, "INTERNAL_ERROR");
      }
      if (!isJsonValue(view)) {
        throw new ServerError(500, "INTERNAL_ERROR");
      }
      return {
        type: "match.snapshot",
        protocolVersion: PROTOCOL_VERSION,
        gameId: aggregate.definition.manifest.id,
        gameVersion: aggregate.definition.manifest.gameVersion,
        revision: aggregate.revision,
        status: aggregate.status,
        viewer,
        view,
        outcome: aggregate.outcome,
        ...(causedByCommandId === undefined ? {} : { causedByCommandId }),
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
        revision: this.#requireAggregate().revision,
        code: "ROOM_CRASH",
      });
    }

    #storedRoom(): StoredGameRoom {
      const aggregate = this.#requireAggregate();
      const players: StoredPlayerSlot[] = aggregate.slots.map((slot) => ({
        slotId: slot.slotId,
        playerSessionId: slot.playerSessionId,
        reservedUntilMilliseconds: slot.reservedUntilMilliseconds,
      }));
      return {
        roomId: this.roomId,
        roomCode: aggregate.roomCode,
        gameId: aggregate.definition.manifest.id,
        gameVersion: aggregate.definition.manifest.gameVersion,
        initialConfig: aggregate.initialConfig,
        players,
        state: aggregate.state,
        rng: aggregate.rng,
        revision: aggregate.revision,
        status: aggregate.status,
        outcome: aggregate.outcome,
        replayId: aggregate.replayId,
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
