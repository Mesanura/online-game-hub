import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import {
  isGameId,
  isGameVersion,
  isJsonValue,
} from "@online-game-hub/game-sdk";
import type {
  CanonicalReplay,
  MatchArchive,
  StoredGameRoom,
} from "@online-game-hub/game-server-runtime";
import { matchStatusSchema } from "@online-game-hub/protocol";
import type { MatchStatus } from "@online-game-hub/protocol";

import type { OnlineGameHubDatabase } from "./client.js";
import { DatabaseError } from "./errors.js";
import { PostgresReplayStore } from "./postgres-replay-store.js";
import { matchPlayers, matches, replays } from "./schema.js";

export const MAX_MATCH_HISTORY_RESULTS = 50;

type DatabaseTransaction = Parameters<
  Parameters<OnlineGameHubDatabase["transaction"]>[0]
>[0];

export interface MatchHistoryItem {
  readonly matchId: string;
  readonly roundNumber: number;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly status: MatchStatus;
  readonly finalRevision: number;
  readonly playerSlotId: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly replayAvailable: boolean;
}

export interface AuthorizedReplayMatch {
  readonly roundNumber: number;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly status: "completed";
  readonly finalRevision: number;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export type UserMatchReplayRead =
  | { readonly status: "not-found" }
  | { readonly status: "unavailable" }
  | {
      readonly status: "available";
      readonly playerSlotId: string;
      readonly match: AuthorizedReplayMatch;
      readonly replay: CanonicalReplay;
    };

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validStoredRoom(room: StoredGameRoom): boolean {
  const round = room.currentRound;
  const assignedSessions = room.players
    .map((player) => player.playerSessionId)
    .filter((session): session is string => session !== null);
  return (
    round !== null &&
    room.roomId.length > 0 &&
    round.replayId.length > 0 &&
    Number.isSafeInteger(round.roundNumber) &&
    round.roundNumber > 0 &&
    isGameId(room.gameId) &&
    isGameVersion(room.gameVersion) &&
    matchStatusSchema.safeParse(round.status).success &&
    Number.isSafeInteger(round.revision) &&
    round.revision >= 0 &&
    isJsonValue(room.initialConfig) &&
    isJsonValue(round.state) &&
    isJsonValue(round.outcome) &&
    room.players.length > 0 &&
    assignedSessions.length === room.players.length &&
    room.players.every(
      (player) =>
        player.slotId.length > 0 &&
        (player.playerSessionId === null ||
          player.playerSessionId.length > 0) &&
        (player.userId === undefined ||
          player.userId === null ||
          validUuid(player.userId)),
    ) &&
    new Set(room.players.map((player) => player.slotId)).size ===
      room.players.length &&
    round.playerOrder.length === room.players.length &&
    new Set(round.playerOrder).size === round.playerOrder.length &&
    round.playerOrder.every((slotId) =>
      room.players.some((player) => player.slotId === slotId),
    ) &&
    new Set(assignedSessions).size === assignedSessions.length
  );
}

async function lockRuntimeRoom(
  transaction: DatabaseTransaction,
  runtimeRoomId: string,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${runtimeRoomId}, 1))`,
  );
}

async function assertSameParticipants(
  transaction: DatabaseTransaction,
  previousMatchId: string,
  room: StoredGameRoom,
): Promise<void> {
  const previousPlayers = await transaction
    .select({
      playerSlotId: matchPlayers.playerSlotId,
      playerSessionId: matchPlayers.playerSessionId,
      userId: matchPlayers.userId,
    })
    .from(matchPlayers)
    .where(eq(matchPlayers.matchId, previousMatchId));
  const currentPlayers = room.players
    .filter(
      (
        player,
      ): player is typeof player & { readonly playerSessionId: string } =>
        player.playerSessionId !== null,
    )
    .map((player) => ({
      playerSlotId: player.slotId,
      playerSessionId: player.playerSessionId,
      userId: player.userId ?? null,
    }));
  if (
    previousPlayers.length !== currentPlayers.length ||
    currentPlayers.some(
      (current) =>
        !previousPlayers.some(
          (previous) =>
            previous.playerSlotId === current.playerSlotId &&
            previous.playerSessionId === current.playerSessionId &&
            previous.userId === current.userId,
        ),
    )
  ) {
    throw new DatabaseError("DATABASE_OPERATION_ERROR");
  }
}

async function recordAssignedPlayers(
  transaction: DatabaseTransaction,
  matchId: string,
  room: StoredGameRoom,
): Promise<void> {
  const assigned = room.players.filter(
    (player): player is typeof player & { readonly playerSessionId: string } =>
      player.playerSessionId !== null,
  );
  for (const player of assigned) {
    await transaction
      .insert(matchPlayers)
      .values({
        matchId,
        playerSlotId: player.slotId,
        playerSessionId: player.playerSessionId,
        userId: player.userId ?? null,
      })
      .onConflictDoNothing();
    const storedRows = await transaction
      .select({
        playerSessionId: matchPlayers.playerSessionId,
        userId: matchPlayers.userId,
      })
      .from(matchPlayers)
      .where(
        and(
          eq(matchPlayers.matchId, matchId),
          eq(matchPlayers.playerSlotId, player.slotId),
        ),
      )
      .limit(1);
    const stored = storedRows[0];
    if (
      stored === undefined ||
      stored.playerSessionId !== player.playerSessionId ||
      stored.userId !== (player.userId ?? null)
    ) {
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }
}

function parseHistoryRow(row: {
  readonly matchId: string;
  readonly roundNumber: number;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly status: string;
  readonly finalRevision: number;
  readonly playerSlotId: string;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly abandonedAt: Date | null;
  readonly replayCompletedAt: Date | null;
}): MatchHistoryItem {
  const parsedStatus = matchStatusSchema.safeParse(row.status);
  if (
    !validUuid(row.matchId) ||
    !Number.isSafeInteger(row.roundNumber) ||
    row.roundNumber <= 0 ||
    !isGameId(row.gameId) ||
    !isGameVersion(row.gameVersion) ||
    !parsedStatus.success ||
    !Number.isSafeInteger(row.finalRevision) ||
    row.finalRevision < 0 ||
    row.playerSlotId.length === 0 ||
    !validDate(row.createdAt) ||
    (row.startedAt !== null && !validDate(row.startedAt)) ||
    (row.completedAt !== null && !validDate(row.completedAt)) ||
    (row.abandonedAt !== null && !validDate(row.abandonedAt)) ||
    (row.replayCompletedAt !== null && !validDate(row.replayCompletedAt))
  ) {
    throw new DatabaseError("DATABASE_DATA_INVALID");
  }
  const finishedAt = row.completedAt ?? row.abandonedAt;
  return {
    matchId: row.matchId,
    roundNumber: row.roundNumber,
    gameId: row.gameId,
    gameVersion: row.gameVersion,
    status: parsedStatus.data,
    finalRevision: row.finalRevision,
    playerSlotId: row.playerSlotId,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: finishedAt?.toISOString() ?? null,
    replayAvailable:
      parsedStatus.data === "completed" && row.replayCompletedAt !== null,
  };
}

function validateLimit(limit: number): void {
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > MAX_MATCH_HISTORY_RESULTS
  ) {
    throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
  }
}

function parseAuthorizedReplayMatch(row: {
  readonly roundNumber: number;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly status: string;
  readonly finalRevision: number;
  readonly playerSlotId: string;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly replayCompletedAt: Date | null;
}):
  | { readonly status: "unavailable" }
  | {
      readonly status: "available";
      readonly playerSlotId: string;
      readonly match: AuthorizedReplayMatch;
    } {
  const parsedStatus = matchStatusSchema.safeParse(row.status);
  if (
    !Number.isSafeInteger(row.roundNumber) ||
    row.roundNumber <= 0 ||
    !isGameId(row.gameId) ||
    !isGameVersion(row.gameVersion) ||
    !parsedStatus.success ||
    !Number.isSafeInteger(row.finalRevision) ||
    row.finalRevision < 0 ||
    row.playerSlotId.length === 0 ||
    !validDate(row.createdAt) ||
    (row.startedAt !== null && !validDate(row.startedAt)) ||
    (row.completedAt !== null && !validDate(row.completedAt)) ||
    (row.replayCompletedAt !== null && !validDate(row.replayCompletedAt))
  ) {
    throw new DatabaseError("DATABASE_DATA_INVALID");
  }
  if (
    parsedStatus.data !== "completed" ||
    row.startedAt === null ||
    row.completedAt === null ||
    row.replayCompletedAt === null
  ) {
    return { status: "unavailable" };
  }
  return {
    status: "available",
    playerSlotId: row.playerSlotId,
    match: {
      roundNumber: row.roundNumber,
      gameId: row.gameId,
      gameVersion: row.gameVersion,
      status: "completed",
      finalRevision: row.finalRevision,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.completedAt.toISOString(),
    },
  };
}

export class PostgresMatchRepository {
  public constructor(private readonly database: OnlineGameHubDatabase) {}

  public async recordRoomCreated(room: StoredGameRoom): Promise<void> {
    const round = room.currentRound;
    if (
      !validStoredRoom(room) ||
      round === null ||
      round.status !== "active" ||
      round.revision !== 0
    ) {
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
    try {
      await this.database.transaction(async (transaction) => {
        await lockRuntimeRoom(transaction, room.roomId);
        const replayRows = await transaction
          .select({
            gameId: replays.gameId,
            gameVersion: replays.gameVersion,
          })
          .from(replays)
          .where(eq(replays.id, round.replayId))
          .for("update")
          .limit(1);
        const replay = replayRows[0];
        if (
          replay === undefined ||
          replay.gameId !== room.gameId ||
          replay.gameVersion !== room.gameVersion
        ) {
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }

        if (round.roundNumber > 1) {
          const previousRows = await transaction
            .select()
            .from(matches)
            .where(
              and(
                eq(matches.runtimeRoomId, room.roomId),
                eq(matches.roundNumber, round.roundNumber - 1),
              ),
            )
            .for("update")
            .limit(1);
          const previous = previousRows[0];
          if (
            previous === undefined ||
            previous.status !== "completed" ||
            previous.gameId !== room.gameId ||
            previous.gameVersion !== room.gameVersion
          ) {
            throw new DatabaseError("DATABASE_OPERATION_ERROR");
          }
          await assertSameParticipants(transaction, previous.id, room);
        }

        await transaction
          .insert(matches)
          .values({
            id: randomUUID(),
            runtimeRoomId: room.roomId,
            roundNumber: round.roundNumber,
            replayId: round.replayId,
            gameId: room.gameId,
            gameVersion: room.gameVersion,
            status: "active",
            finalRevision: 0,
            startedAt: new Date(),
          })
          .onConflictDoNothing();
        const matchRows = await transaction
          .select()
          .from(matches)
          .where(
            and(
              eq(matches.runtimeRoomId, room.roomId),
              eq(matches.roundNumber, round.roundNumber),
            ),
          )
          .for("update")
          .limit(1);
        const match = matchRows[0];
        if (
          match === undefined ||
          match.replayId !== round.replayId ||
          match.roundNumber !== round.roundNumber ||
          match.gameId !== room.gameId ||
          match.gameVersion !== room.gameVersion ||
          !["waiting", "active"].includes(match.status) ||
          match.finalRevision !== 0
        ) {
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }
        if (match.status === "waiting") {
          await transaction
            .update(matches)
            .set({ status: "active", startedAt: new Date() })
            .where(eq(matches.id, match.id));
        }
        await recordAssignedPlayers(transaction, match.id, room);
      });
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  public async recordRoomSaved(room: StoredGameRoom): Promise<void> {
    const round = room.currentRound;
    if (!validStoredRoom(room) || round === null) {
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
    try {
      await this.database.transaction(async (transaction) => {
        await lockRuntimeRoom(transaction, room.roomId);
        const matchRows = await transaction
          .select()
          .from(matches)
          .where(eq(matches.replayId, round.replayId))
          .for("update")
          .limit(1);
        const match = matchRows[0];
        if (
          match === undefined ||
          match.runtimeRoomId !== room.roomId ||
          match.replayId !== round.replayId ||
          match.roundNumber !== round.roundNumber ||
          match.gameId !== room.gameId ||
          match.gameVersion !== room.gameVersion ||
          round.revision < match.finalRevision
        ) {
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }
        await recordAssignedPlayers(transaction, match.id, room);

        if (round.status === "completed") {
          if (
            match.status !== "completed" ||
            match.completedAt === null ||
            match.finalRevision !== round.revision
          ) {
            throw new DatabaseError("DATABASE_OPERATION_ERROR");
          }
          return;
        }
        if (
          match.status === "completed" ||
          (match.status === "abandoned" && round.status !== "abandoned")
        ) {
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }

        if (round.status === "active") {
          await transaction
            .update(matches)
            .set({
              status: "active",
              finalRevision: round.revision,
              startedAt: match.startedAt ?? new Date(),
            })
            .where(eq(matches.id, match.id));
          return;
        }
        if (round.status === "abandoned") {
          await transaction
            .update(matches)
            .set({
              status: "abandoned",
              finalRevision: round.revision,
              abandonedAt: match.abandonedAt ?? new Date(),
            })
            .where(eq(matches.id, match.id));
          return;
        }
        if (match.status !== "waiting") {
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }
      });
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  public async abandonIncompleteMatches(): Promise<number> {
    try {
      const abandoned = await this.database
        .update(matches)
        .set({ status: "abandoned", abandonedAt: new Date() })
        .where(inArray(matches.status, ["waiting", "active"]))
        .returning({ id: matches.id });
      return abandoned.length;
    } catch {
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  public async listForUser(
    userId: string,
    limit = MAX_MATCH_HISTORY_RESULTS,
  ): Promise<readonly MatchHistoryItem[]> {
    if (!validUuid(userId)) {
      throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
    }
    return this.#list(eq(matchPlayers.userId, userId), limit);
  }

  /**
   * Returns a completed replay only when this exact account occupied one
   * unambiguous archived player slot. Replay internals stay server-side.
   */
  public async getCompletedReplayForUser(
    userId: string,
    matchId: string,
  ): Promise<UserMatchReplayRead> {
    if (!validUuid(userId)) {
      throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
    }
    if (!validUuid(matchId)) return { status: "not-found" };
    try {
      const rows = await this.database
        .select({
          replayId: matches.replayId,
          roundNumber: matches.roundNumber,
          gameId: matches.gameId,
          gameVersion: matches.gameVersion,
          status: matches.status,
          finalRevision: matches.finalRevision,
          playerSlotId: matchPlayers.playerSlotId,
          createdAt: matches.createdAt,
          startedAt: matches.startedAt,
          completedAt: matches.completedAt,
          replayCompletedAt: replays.completedAt,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .innerJoin(replays, eq(replays.id, matches.replayId))
        .where(and(eq(matchPlayers.userId, userId), eq(matches.id, matchId)))
        .limit(2);
      if (rows.length !== 1) return { status: "not-found" };
      const row = rows[0];
      if (row === undefined) return { status: "not-found" };
      const parsed = parseAuthorizedReplayMatch(row);
      if (parsed.status === "unavailable") return parsed;
      const replay = await new PostgresReplayStore(this.database).get(
        row.replayId,
      );
      if (replay === null) throw new DatabaseError("DATABASE_DATA_INVALID");
      return { ...parsed, replay };
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  async #list(
    identityCondition: SQL<unknown>,
    limit: number,
  ): Promise<readonly MatchHistoryItem[]> {
    validateLimit(limit);
    return this.#historyRows(identityCondition, limit);
  }

  async #historyRows(
    identityCondition: SQL<unknown>,
    limit: number,
  ): Promise<readonly MatchHistoryItem[]> {
    try {
      const rows = await this.database
        .select({
          matchId: matches.id,
          roundNumber: matches.roundNumber,
          gameId: matches.gameId,
          gameVersion: matches.gameVersion,
          status: matches.status,
          finalRevision: matches.finalRevision,
          playerSlotId: matchPlayers.playerSlotId,
          createdAt: matches.createdAt,
          startedAt: matches.startedAt,
          completedAt: matches.completedAt,
          abandonedAt: matches.abandonedAt,
          replayCompletedAt: replays.completedAt,
        })
        .from(matchPlayers)
        .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
        .innerJoin(replays, eq(replays.id, matches.replayId))
        .where(identityCondition)
        .orderBy(desc(matches.createdAt), desc(matches.id))
        .limit(limit);
      return rows.map((row) => parseHistoryRow(row));
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }
}

export class PostgresMatchArchive implements MatchArchive {
  public constructor(private readonly repository: PostgresMatchRepository) {}

  public createRound(room: StoredGameRoom): Promise<void> {
    return this.repository.recordRoomCreated(room);
  }

  public saveRound(room: StoredGameRoom): Promise<void> {
    return this.repository.recordRoomSaved(room);
  }
}
