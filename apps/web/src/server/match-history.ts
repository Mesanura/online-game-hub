import "server-only";

import {
  PostgresRealtimeMatchRepository,
  PostgresMatchRepository,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import { projectMatchHistoryResult } from "@online-game-hub/game-registry/history";
import type { AccountMatchHistoryItem } from "../lib/match-history";
import type { UserMatchReplayRead } from "@online-game-hub/database";
import type { UserRealtimeMatchReplayRead } from "@online-game-hub/database";
import {
  resolveGameDefinition,
  resolveRealtimeGameDefinition,
} from "@online-game-hub/game-registry/server";

import type { WebServerConfig } from "./config";

export function getGameReplayMode(gameId: string, gameVersion: string) {
  // History must use the recorded version, including frozen definitions that
  // are intentionally absent from the current-game catalog.
  return (
    resolveGameDefinition(gameId, gameVersion) ??
    resolveRealtimeGameDefinition(gameId, gameVersion)
  )?.manifest.capabilities.replay;
}

export async function listUserMatchHistory(
  config: WebServerConfig,
  userId: string,
): Promise<readonly AccountMatchHistoryItem[]> {
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
      new PostgresMatchRepository(client.database).listForUserWithResults(
        userId,
      ),
      new PostgresRealtimeMatchRepository(
        client.database,
      ).listForUserWithResults(userId),
    ]);
    return [...turnBased, ...realtime]
      .sort((left, right) => {
        const byDate = right.createdAt.localeCompare(left.createdAt);
        return byDate !== 0
          ? byDate
          : right.matchId.localeCompare(left.matchId);
      })
      .slice(0, 50)
      .map((match) => ({
        matchId: match.matchId,
        roundNumber: match.roundNumber,
        gameId: match.gameId,
        gameVersion: match.gameVersion,
        status: match.status,
        finalRevision: match.finalRevision,
        playerSlotId: match.playerSlotId,
        createdAt: match.createdAt,
        startedAt: match.startedAt,
        finishedAt: match.finishedAt,
        result: projectMatchHistoryResult(match),
        replayAvailable:
          match.replayAvailable &&
          getGameReplayMode(match.gameId, match.gameVersion) ===
            "player-playback",
      })) satisfies readonly AccountMatchHistoryItem[];
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
