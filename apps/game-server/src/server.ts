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
import type {
  ExactGameDefinitionResolver,
  CurrentGameDefinitionResolver,
  MatchArchive,
  MetricsCollector,
  ReplayStore,
  RoomStore,
  RuntimeClock,
  RuntimeIdSource,
  RuntimeLogger,
  TicketVerifier,
} from "@online-game-hub/game-server-runtime";
import {
  resolveCurrentGameDefinition,
  resolveGameDefinition,
} from "@online-game-hub/game-registry/server";

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
  readonly roomStore?: RoomStore;
  readonly replayStore?: ReplayStore;
  readonly matchArchive?: MatchArchive;
  readonly clock?: RuntimeClock;
  readonly ids?: RuntimeIdSource;
  readonly metrics?: MetricsCollector;
  readonly logger?: RuntimeLogger;
  readonly reconnectGraceMilliseconds?: number;
  readonly terminalRoomTtlMilliseconds?: number;
}

export interface GameServerApplication {
  readonly roomStore: RoomStore;
  readonly replayStore: ReplayStore;
  readonly metrics: MetricsCollector;
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
  const transport = new WebSocketTransport();
  const RoomClass = createAuthoritativeGameRoomClass({
    ticketVerifier: options.ticketVerifier,
    resolveCurrentDefinition:
      options.resolveCurrentDefinition ?? resolveCurrentGameDefinition,
    resolveDefinition: options.resolveDefinition ?? resolveGameDefinition,
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
  };
  const routes = createRouter({
    health: createEndpoint("/health", { method: "GET" }, async () =>
      Response.json({ status: "ok" }, { status: 200 }),
    ),
    metrics: createEndpoint("/metrics", { method: "GET" }, async () =>
      Response.json({ samples: metrics.snapshot() }, { status: 200 }),
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
