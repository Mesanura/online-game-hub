import "server-only";

import {
  PostgresRealtimeMatchRepository,
  PostgresMatchRepository,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import type { MatchHistoryItem } from "@online-game-hub/database";
import type { UserMatchReplayRead } from "@online-game-hub/database";
import type { UserRealtimeMatchReplayRead } from "@online-game-hub/database";

import type { WebServerConfig } from "./config";

export async function listUserMatchHistory(
  config: WebServerConfig,
  userId: string,
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
    const [turnBased, realtime] = await Promise.all([
      new PostgresMatchRepository(client.database).listForUser(userId),
      new PostgresRealtimeMatchRepository(client.database).listForUser(userId),
    ]);
    return [...turnBased, ...realtime]
      .sort((left, right) => {
        const byDate = right.createdAt.localeCompare(left.createdAt);
        return byDate !== 0
          ? byDate
          : right.matchId.localeCompare(left.matchId);
      })
      .slice(0, 50) satisfies readonly MatchHistoryItem[];
  } finally {
    await client.close();
  }
}

export async function getUserRealtimeMatchReplay(
  config: WebServerConfig,
  userId: string,
  matchId: string,
): Promise<UserRealtimeMatchReplayRead> {
  if (config.databaseMode !== "postgres" || config.databaseUrl === null) {
    throw new Error("MATCH_HISTORY_DATABASE_UNAVAILABLE");
  }
  const client = createPostgresDatabaseClient({
    url: config.databaseUrl,
    applicationName: "online-game-hub-web-realtime-replay",
    maxConnections: 2,
  });
  try {
    return await new PostgresRealtimeMatchRepository(
      client.database,
    ).getCompletedReplayForUser(userId, matchId);
  } finally {
    await client.close();
  }
}

export async function getUserMatchReplay(
  config: WebServerConfig,
  userId: string,
  matchId: string,
): Promise<UserMatchReplayRead> {
  if (config.databaseMode !== "postgres" || config.databaseUrl === null) {
    throw new Error("MATCH_HISTORY_DATABASE_UNAVAILABLE");
  }
  const client = createPostgresDatabaseClient({
    url: config.databaseUrl,
    applicationName: "online-game-hub-web-replay",
    maxConnections: 2,
  });
  try {
    return await new PostgresMatchRepository(
      client.database,
    ).getCompletedReplayForUser(userId, matchId);
  } finally {
    await client.close();
  }
}
