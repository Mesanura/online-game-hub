import "server-only";

import {
  PostgresMatchRepository,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import type { MatchHistoryItem } from "@online-game-hub/database";

import type { WebServerConfig } from "./config";

export async function listGuestMatchHistory(
  config: WebServerConfig,
  playerSessionId: string,
): Promise<readonly MatchHistoryItem[]> {
  if (config.databaseMode !== "postgres" || config.databaseUrl === null) {
    throw new Error("MATCH_HISTORY_DATABASE_UNAVAILABLE");
  }
  const client = createPostgresDatabaseClient({
    url: config.databaseUrl,
    applicationName: "online-game-hub-web-history",
    maxConnections: 2,
  });
  try {
    return await new PostgresMatchRepository(client.database).listForGuest(
      playerSessionId,
    );
  } finally {
    await client.close();
  }
}
