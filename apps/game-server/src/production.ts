import {
  PostgresMatchArchive,
  PostgresMatchRepository,
  PostgresReplayStore,
  PostgresRealtimeMatchArchive,
  PostgresRealtimeReplayStore,
  PostgresRealtimeRoomStore,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import type { PostgresDatabaseClient } from "@online-game-hub/database";

import type { GameServerCompositionOptions } from "./server.js";
import { createGameServer } from "./server.js";
import { createGameServerTicketVerifier } from "./ticket-verifier.js";
import type { GameServerConfig } from "./config.js";
import { configureGameServerCors } from "./cors.js";
import { resolveRealtimeGameDefinition } from "@online-game-hub/game-registry/server";

export type ProductionGameServerOverrides = Omit<
  GameServerCompositionOptions,
  | "ticketVerifier"
  | "reconnectGraceMilliseconds"
  | "roomStore"
  | "replayStore"
  | "matchArchive"
>;

export function createProductionGameServer(
  config: GameServerConfig,
  overrides: ProductionGameServerOverrides = {},
) {
  let databaseClient: PostgresDatabaseClient | null = null;
  let matchRepository: PostgresMatchRepository | null = null;
  if (config.databaseMode === "postgres") {
    if (config.databaseUrl === null) {
      throw new Error("GAME_SERVER_DATABASE_CONFIGURATION_ERROR");
    }
    databaseClient = createPostgresDatabaseClient({
      url: config.databaseUrl,
      applicationName: "online-game-hub-game-server",
      maxConnections: 10,
    });
    matchRepository = new PostgresMatchRepository(databaseClient.database);
  }
  const replayStore =
    databaseClient === null
      ? undefined
      : new PostgresReplayStore(databaseClient.database);
  const matchArchive =
    matchRepository === null
      ? undefined
      : new PostgresMatchArchive(matchRepository);
  const realtimeReplayStore =
    databaseClient === null
      ? undefined
      : new PostgresRealtimeReplayStore(databaseClient.database, {
          resolveDefinition: resolveRealtimeGameDefinition,
        });
  const realtimeRoomStore =
    databaseClient === null
      ? undefined
      : new PostgresRealtimeRoomStore(databaseClient.database);
  const realtimeMatchArchive =
    databaseClient === null
      ? undefined
      : new PostgresRealtimeMatchArchive(databaseClient.database, {
          resolveDefinition: resolveRealtimeGameDefinition,
        });
  const application = createGameServer({
    ...overrides,
    ...(matchArchive === undefined ? {} : { matchArchive }),
    ...(replayStore === undefined ? {} : { replayStore }),
    ...(realtimeReplayStore === undefined ? {} : { realtimeReplayStore }),
    ...(realtimeRoomStore === undefined ? {} : { realtimeRoomStore }),
    ...(realtimeMatchArchive === undefined ? {} : { realtimeMatchArchive }),
    ticketVerifier: createGameServerTicketVerifier({
      issuer: config.ticketIssuer,
      secret: config.ticketSecret,
    }),
    reconnectGraceMilliseconds: config.reconnectGraceMilliseconds,
    realtimeReconnectGraceMilliseconds: config.reconnectGraceMilliseconds,
  });
  let restoreCors: (() => void) | null = null;
  let startupCoordinated = false;
  let databaseClosed = false;

  return {
    roomStore: application.roomStore,
    replayStore: application.replayStore,
    realtimeReplayStore: application.realtimeReplayStore,
    metrics: application.metrics,
    address: () => application.address(),
    async start(options = {}) {
      if (databaseClosed) {
        throw new Error("GAME_SERVER_ALREADY_STOPPED");
      }
      restoreCors ??= configureGameServerCors(config.allowedWebOrigins);
      try {
        if (!startupCoordinated && matchRepository !== null) {
          await matchRepository.abandonIncompleteMatches();
          startupCoordinated = true;
        }
        return await application.start({
          hostname: options.hostname ?? config.hostname,
          port: options.port ?? config.port,
        });
      } catch (error) {
        restoreCors();
        restoreCors = null;
        throw error;
      }
    },
    async stop() {
      try {
        await application.stop();
      } finally {
        try {
          if (!databaseClosed) {
            databaseClosed = true;
            await databaseClient?.close();
          }
        } finally {
          restoreCors?.();
          restoreCors = null;
        }
      }
    },
  } satisfies ReturnType<typeof createGameServer>;
}
