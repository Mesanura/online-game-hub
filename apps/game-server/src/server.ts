import {
  createEndpoint,
  createRouter,
  defineRoom,
  defineServer,
} from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import {
  GAME_ROOM_NAME,
  InMemoryMetricsCollector,
  InMemoryReplayStore,
  InMemoryRoomStore,
  createAuthoritativeGameRoomClass,
  secureRuntimeIdSource,
  systemRuntimeClock,
} from "@online-game-hub/game-server-runtime";
import {
  createRealtimeGameRoomClass,
  InMemoryRealtimeReplayStore,
  InMemoryRealtimeRoomStore,
  REALTIME_GAME_ROOM_NAME,
} from "@online-game-hub/realtime-game-server-runtime";
import type {
  RealtimeGameRoomClass,
  RealtimeMatchArchive,
  RealtimeRoomStore,
  RealtimeRuntimeClock,
  RealtimeRuntimeIdSource,
  RealtimePlatformRandom,
  RealtimeSchedulerTimer,
  RealtimeTicketVerifier,
  RealtimeReplayStore,
} from "@online-game-hub/realtime-game-server-runtime";
import type { UnknownRealtimeGameDefinition } from "@online-game-hub/realtime-game-sdk";
import {
  roomDiscoveryQuerySchema,
  roomDiscoverySchema,
} from "@online-game-hub/protocol";
import type {
  ExactGameDefinitionResolver,
  ExactRoundSetupDefinitionResolver,
  CurrentGameDefinitionResolver,
  MatchArchive,
  MetricsCollector,
  ReplayStore,
  RoomStore,
  RuntimeClock,
  RuntimeIdSource,
  RuntimeLogger,
  SetupProtocolResolver,
  TicketVerifier,
} from "@online-game-hub/game-server-runtime";
import {
  resolveCurrentGameDefinition,
  resolveGameDefinition,
  resolveCurrentRealtimeGameDefinition,
  resolveRealtimeGameDefinition,
  resolveRoundSetupDefinition,
} from "@online-game-hub/game-registry/server";
import { resolveGameDeployment } from "@online-game-hub/game-registry/deployment";

export interface GameServerStartOptions {
  readonly hostname?: string;
  readonly port?: number;
}

export interface GameServerAddress {
  readonly hostname: string;
  readonly port: number;
  readonly httpUrl: string;
  readonly websocketUrl: string;
}

export interface GameServerCompositionOptions {
  readonly ticketVerifier: TicketVerifier;
  readonly resolveCurrentDefinition?: CurrentGameDefinitionResolver;
  readonly resolveDefinition?: ExactGameDefinitionResolver;
  readonly resolveRoundSetupDefinition?: ExactRoundSetupDefinitionResolver;
  readonly resolveSetupProtocol?: SetupProtocolResolver;
  readonly roomStore?: RoomStore;
  readonly replayStore?: ReplayStore;
  readonly matchArchive?: MatchArchive;
  readonly clock?: RuntimeClock;
  readonly ids?: RuntimeIdSource;
  readonly metrics?: MetricsCollector;
  readonly logger?: RuntimeLogger;
  readonly reconnectGraceMilliseconds?: number;
  readonly terminalRoomTtlMilliseconds?: number;
  readonly realtimeReplayStore?: RealtimeReplayStore;
  readonly realtimeRoomStore?: RealtimeRoomStore;
  readonly realtimeMatchArchive?: RealtimeMatchArchive;
  readonly realtimeClock?: RealtimeRuntimeClock;
  readonly realtimeIds?: RealtimeRuntimeIdSource;
  readonly realtimeTicketVerifier?: RealtimeTicketVerifier;
  readonly resolveCurrentRealtimeDefinition?: (
    gameId: string,
  ) => UnknownRealtimeGameDefinition | undefined;
  readonly resolveRealtimeDefinition?: (
    gameId: string,
    gameVersion: string,
  ) => UnknownRealtimeGameDefinition | undefined;
  readonly realtimeReconnectGraceMilliseconds?: number;
  readonly realtimeTerminalRoomTtlMilliseconds?: number;
  readonly realtimeRandom?: RealtimePlatformRandom;
  readonly realtimeSchedulerTimer?: RealtimeSchedulerTimer;
}

export interface GameServerApplication {
  readonly roomStore: RoomStore;
  readonly replayStore: ReplayStore;
  readonly metrics: MetricsCollector;
  readonly realtimeReplayStore: RealtimeReplayStore;
  start(options?: GameServerStartOptions): Promise<GameServerAddress>;
  stop(): Promise<void>;
  address(): GameServerAddress | null;
}

export function createConsoleRuntimeLogger(
  writeLine: (line: string) => void = (line) =>
    process.stdout.write(`${line}\n`),
): RuntimeLogger {
  return { write: (event) => writeLine(JSON.stringify(event)) };
}

export function createGameServer(
  options: GameServerCompositionOptions,
): GameServerApplication {
  const roomStore = options.roomStore ?? new InMemoryRoomStore();
  const replayStore = options.replayStore ?? new InMemoryReplayStore();
  const metrics = options.metrics ?? new InMemoryMetricsCollector();
  const realtimeReplayStore =
    options.realtimeReplayStore ?? new InMemoryRealtimeReplayStore();
  const realtimeRoomStore =
    options.realtimeRoomStore ?? new InMemoryRealtimeRoomStore();
  const realtimeVerifier =
    options.realtimeTicketVerifier ?? options.ticketVerifier;
  const RealtimeRoomClass: RealtimeGameRoomClass = createRealtimeGameRoomClass({
    ticketVerifier: realtimeVerifier,
    resolveCurrentDefinition:
      options.resolveCurrentRealtimeDefinition ??
      resolveCurrentRealtimeGameDefinition,
    resolveDefinition:
      options.resolveRealtimeDefinition ?? resolveRealtimeGameDefinition,
    resolveRoundSetupDefinition:
      options.resolveRoundSetupDefinition ?? resolveRoundSetupDefinition,
    resolveSetupProtocol:
      options.resolveSetupProtocol ??
      ((gameId, gameVersion) =>
        resolveGameDeployment(gameId, gameVersion)?.setupProtocol),
    replayStore: realtimeReplayStore,
    roomStore: realtimeRoomStore,
    ...(options.realtimeMatchArchive === undefined
      ? {}
      : { matchArchive: options.realtimeMatchArchive }),
    ...(options.realtimeClock === undefined
      ? {}
      : { clock: options.realtimeClock }),
    ...(options.realtimeIds === undefined ? {} : { ids: options.realtimeIds }),
    ...(options.realtimeReconnectGraceMilliseconds === undefined
      ? {}
      : {
          reconnectGraceMilliseconds:
            options.realtimeReconnectGraceMilliseconds,
        }),
    ...(options.realtimeTerminalRoomTtlMilliseconds === undefined
      ? {}
      : {
          terminalRoomTtlMilliseconds:
            options.realtimeTerminalRoomTtlMilliseconds,
        }),
    ...(options.realtimeRandom === undefined
      ? {}
      : { random: options.realtimeRandom }),
    ...(options.realtimeSchedulerTimer === undefined
      ? {}
      : { schedulerTimer: options.realtimeSchedulerTimer }),
  });
  const transport = new WebSocketTransport();
  const RoomClass = createAuthoritativeGameRoomClass({
    ticketVerifier: options.ticketVerifier,
    resolveCurrentDefinition:
      options.resolveCurrentDefinition ?? resolveCurrentGameDefinition,
    resolveDefinition: options.resolveDefinition ?? resolveGameDefinition,
    resolveRoundSetupDefinition:
      options.resolveRoundSetupDefinition ?? resolveRoundSetupDefinition,
    resolveSetupProtocol:
      options.resolveSetupProtocol ??
      ((gameId, gameVersion) =>
        resolveGameDeployment(gameId, gameVersion)?.setupProtocol),
    roomStore,
    replayStore,
    ...(options.matchArchive === undefined
      ? {}
      : { matchArchive: options.matchArchive }),
    clock: options.clock ?? systemRuntimeClock,
    ids: options.ids ?? secureRuntimeIdSource,
    metrics,
    logger: options.logger ?? createConsoleRuntimeLogger(),
    ...(options.reconnectGraceMilliseconds === undefined
      ? {}
      : { reconnectGraceMilliseconds: options.reconnectGraceMilliseconds }),
    ...(options.terminalRoomTtlMilliseconds === undefined
      ? {}
      : { terminalRoomTtlMilliseconds: options.terminalRoomTtlMilliseconds }),
  });
  const rooms = {
    [GAME_ROOM_NAME]: defineRoom(RoomClass).filterBy(["roomCode"]),
    [REALTIME_GAME_ROOM_NAME]: defineRoom(RealtimeRoomClass).filterBy([
      "roomCode",
    ]),
  };
  const routes = createRouter({
    health: createEndpoint("/health", { method: "GET" }, async () =>
      Response.json({ status: "ok" }, { status: 200 }),
    ),
    metrics: createEndpoint("/metrics", { method: "GET" }, async () =>
      Response.json({ samples: metrics.snapshot() }, { status: 200 }),
    ),
    roomDiscovery: createEndpoint(
      "/room-discovery",
      { method: "GET", query: roomDiscoveryQuerySchema },
      async ({ query }) => {
        try {
          const [turnBased, realtime] = await Promise.all([
            roomStore.getByRoomCode(query.roomCode),
            realtimeRoomStore.getByRoomCode(query.roomCode),
          ]);
          const candidates = [
            ...(turnBased !== null &&
            turnBased.closeReason === null &&
            turnBased.gameId === query.gameId
              ? [{ room: turnBased, runtime: "turn-based" as const }]
              : []),
            ...(realtime !== null &&
            realtime.closeReason === null &&
            realtime.gameId === query.gameId
              ? [{ room: realtime, runtime: "realtime" as const }]
              : []),
          ];
          const candidate = candidates.length === 1 ? candidates[0] : undefined;
          if (candidate === undefined) {
            return Response.json(
              { code: "ROOM_NOT_FOUND" },
              {
                status: 404,
                headers: { "cache-control": "no-store" },
              },
            );
          }
          return Response.json(
            roomDiscoverySchema.parse({
              roomCode: candidate.room.roomCode,
              gameId: candidate.room.gameId,
              gameVersion: candidate.room.gameVersion,
              setupProtocol: candidate.room.setupProtocol,
              runtime: candidate.runtime,
            }),
            { status: 200, headers: { "cache-control": "no-store" } },
          );
        } catch {
          return Response.json(
            { code: "ROOM_DISCOVERY_UNAVAILABLE" },
            {
              status: 503,
              headers: { "cache-control": "no-store" },
            },
          );
        }
      },
    ),
  });
  const gameServer = defineServer({
    transport,
    greet: false,
    gracefullyShutdown: false,
    rooms,
    routes,
  });

  let currentAddress: GameServerAddress | null = null;

  return {
    roomStore,
    replayStore,
    metrics,
    realtimeReplayStore,
    address: () => currentAddress,
    async start(startOptions = {}) {
      if (currentAddress !== null) {
        return currentAddress;
      }
      const hostname = startOptions.hostname ?? "127.0.0.1";
      const port = startOptions.port ?? 0;
      if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
        throw new RangeError("Game Server port must be between 0 and 65535.");
      }
      await gameServer.listen(port, hostname);
      const address = transport.server?.address();
      if (
        address === null ||
        address === undefined ||
        typeof address === "string"
      ) {
        await gameServer.gracefullyShutdown(false);
        throw new Error("Game Server did not expose a TCP address.");
      }
      currentAddress = {
        hostname,
        port: address.port,
        httpUrl: `http://${hostname}:${address.port}`,
        websocketUrl: `ws://${hostname}:${address.port}`,
      };
      return currentAddress;
    },
    async stop() {
      if (currentAddress === null) {
        return;
      }
      currentAddress = null;
      await gameServer.gracefullyShutdown(false);
    },
  };
}
