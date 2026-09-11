import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectMatchHistoryResult } from "@online-game-hub/game-registry/history";
import {
  createPostgresDatabaseClient,
  PostgresMatchRepository,
  PostgresRealtimeMatchRepository,
} from "../src/index.js";
import {
  createIsolatedTestDatabase,
  requireTestDatabaseUrl,
  type IsolatedTestDatabase,
} from "../src/testing.js";
import {
  users,
  matches,
  matchPlayers,
  replays,
  realtimeMatches,
  realtimeMatchPlayers,
  realtimeReplays,
} from "../src/schema.js";

describe.sequential("persisted personal history projection inputs", () => {
  let isolated: IsolatedTestDatabase;
  const userA = randomUUID(),
    userB = randomUUID(),
    outsider = randomUUID();
  const players = [
    { slotId: "b", participantRef: "private-b" },
    { slotId: "a", participantRef: "private-a" },
  ];
  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(
      requireTestDatabaseUrl(process.env),
    );
    const db = isolated.client.database;
    await db
      .insert(users)
      .values([userA, userB, outsider].map((id) => ({ id, displayName: id })));
    for (const runtime of ["turn-based", "realtime"] as const) {
      for (const status of ["completed", "active", "abandoned"] as const) {
        const id = randomUUID(),
          date = new Date("2026-09-11T00:00:00Z");
        const completed = status === "completed";
        const replay = {
          id,
          replayFormatVersion: 1,
          gameId: runtime === "realtime" ? "pong" : "tic-tac-toe",
          gameVersion: "1.0.0",
          rngAlgorithm: "fnv1a32-counter-v1",
          rngSeed: "private-seed",
          initialConfig: sql`'null'::jsonb`,
          players,
          recordedOutcome: completed
            ? runtime === "realtime"
              ? {
                  type: "WIN",
                  reason: "SCORE",
                  winnerSlotId: "b",
                  scores: [3, 1],
                }
              : { type: "DRAW" }
            : null,
          recordedRngCursor: completed ? 0 : null,
          completedAt: completed ? date : null,
        };
        const match = {
          id,
          runtimeRoomId: id,
          replayId: id,
          roundNumber: 1,
          gameId: replay.gameId,
          gameVersion: replay.gameVersion,
          status,
          startedAt: date,
          completedAt: completed ? date : null,
          abandonedAt: status === "abandoned" ? date : null,
        };
        const participants = [
          {
            matchId: id,
            playerSlotId: "a",
            playerSessionId: "session-a",
            userId: userA,
          },
          {
            matchId: id,
            playerSlotId: "b",
            playerSessionId: "session-b",
            userId: userB,
          },
        ];
        if (runtime === "realtime") {
          await db.insert(realtimeReplays).values({
            ...replay,
            runtime,
            tickRate: 60,
            finalTick: completed ? 1 : 0,
            initialConfig: { targetScore: 3 },
          });
          await db.insert(realtimeMatches).values(match);
          await db.insert(realtimeMatchPlayers).values(participants);
        } else {
          await db.insert(replays).values(replay);
          await db.insert(matches).values(match);
          await db.insert(matchPlayers).values(participants);
        }
      }
    }
  });
  afterAll(async () => {
    await isolated?.close();
  });

  it("rereads original player order and outcomes on another connection, scoped to each account", async () => {
    const reader = createPostgresDatabaseClient({
      url: isolated.url,
      applicationName: "history-reread",
    });
    try {
      for (const repository of [
        new PostgresMatchRepository(reader.database),
        new PostgresRealtimeMatchRepository(reader.database),
      ]) {
        expect(await repository.listForUserWithResults(outsider)).toEqual([]);
        const a = await repository.listForUserWithResults(userA),
          b = await repository.listForUserWithResults(userB);
        expect(a).toHaveLength(3);
        expect(b).toHaveLength(3);
        const metadata = await repository.listForUser(userA);
        expect(metadata).toHaveLength(3);
        for (const row of metadata) {
          expect(row).not.toHaveProperty("recordedOutcome");
          expect(row).not.toHaveProperty("players");
        }
        for (const row of a) {
          expect(row.players).toEqual(players);
          expect(row.playerSlotId).toBe("a");
          const other = b.find((item) => item.matchId === row.matchId);
          expect(other?.playerSlotId).toBe("b");
          if (row.status !== "completed") {
            expect(projectMatchHistoryResult(row)).toBeNull();
            continue;
          }
          expect(row.recordedOutcome).not.toBeNull();
          expect(projectMatchHistoryResult(row)).toEqual(
            row.gameId === "pong"
              ? { kind: "score", own: 1, opponent: 3 }
              : { kind: "win-loss", value: "draw" },
          );
          if (other !== undefined)
            expect(projectMatchHistoryResult(other)).toEqual(
              row.gameId === "pong"
                ? { kind: "score", own: 3, opponent: 1 }
                : { kind: "win-loss", value: "draw" },
            );
        }
      }
    } finally {
      await reader.close();
    }
  });

  it("keeps malformed archived results readable for a null projection", async () => {
    const db = isolated.client.database;
    const turnRepository = new PostgresMatchRepository(db);
    const realtimeRepository = new PostgresRealtimeMatchRepository(db);
    const turn = (await turnRepository.listForUserWithResults(userA)).find(
      (row) => row.status === "completed",
    );
    const realtime = (
      await realtimeRepository.listForUserWithResults(userA)
    ).find((row) => row.status === "completed");
    if (turn === undefined || realtime === undefined)
      throw new Error("Missing completed fixtures");
    await db
      .update(replays)
      .set({ recordedOutcome: { broken: true } })
      .where(eq(replays.id, turn.matchId));
    await db
      .update(realtimeReplays)
      .set({ players: [{ slotId: "outsider" }] })
      .where(eq(realtimeReplays.id, realtime.matchId));
    for (const repository of [turnRepository, realtimeRepository]) {
      const rows = await repository.listForUserWithResults(userA);
      expect(rows).toHaveLength(3);
      const completed = rows.find((row) => row.status === "completed");
      if (completed === undefined) throw new Error("Missing completed history");
      expect(projectMatchHistoryResult(completed)).toBeNull();
    }
  });
});
