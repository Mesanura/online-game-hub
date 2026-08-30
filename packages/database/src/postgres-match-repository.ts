import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import {
  isGameId,
  isGameVersion,
  isJsonValue,
} from "@online-game-hub/game-sdk";
import { InMemoryRoomStore } from "@online-game-hub/game-server-runtime";
import type {
  RoomStore,
  StoredGameRoom,
} from "@online-game-hub/game-server-runtime";
import { matchStatusSchema } from "@online-game-hub/protocol";
import type { MatchStatus } from "@online-game-hub/protocol";

import type { OnlineGameHubDatabase } from "./client.js";
import { DatabaseError } from "./errors.js";
import {
  guestUserAssociations,
  matchPlayers,
  matches,
  replays,
} from "./schema.js";

export const MAX_MATCH_HISTORY_RESULTS = 50;

type DatabaseTransaction = Parameters<
  Parameters<OnlineGameHubDatabase["transaction"]>[0]
>[0];

export interface MatchHistoryItem {
  readonly matchId: string;
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

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validStoredRoom(room: StoredGameRoom): boolean {
  const assignedSessions = room.players
    .map((player) => player.playerSessionId)
    .filter((session): session is string => session !== null);
  return (
    room.roomId.length > 0 &&
    room.replayId.length > 0 &&
    isGameId(room.gameId) &&
    isGameVersion(room.gameVersion) &&
    matchStatusSchema.safeParse(room.status).success &&
    Number.isSafeInteger(room.revision) &&
    room.revision >= 0 &&
    isJsonValue(room.initialConfig) &&
    isJsonValue(room.state) &&
    isJsonValue(room.outcome) &&
    room.players.length > 0 &&
    room.players.every(
      (player) =>
        player.slotId.length > 0 &&
        (player.playerSessionId === null || player.playerSessionId.length > 0),
    ) &&
    new Set(room.players.map((player) => player.slotId)).size ===
      room.players.length &&
    new Set(assignedSessions).size === assignedSessions.length
  );
}

async function lockGuestSessions(
  transaction: DatabaseTransaction,
  playerSessionIds: readonly string[],
): Promise<void> {
  for (const playerSessionId of [...new Set(playerSessionIds)].sort()) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${playerSessionId}, 0))`,
    );
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
  await lockGuestSessions(
    transaction,
    assigned.map((player) => player.playerSessionId),
  );
  for (const player of assigned) {
    const associationRows = await transaction
      .select({ userId: guestUserAssociations.userId })
      .from(guestUserAssociations)
      .where(eq(guestUserAssociations.playerSessionId, player.playerSessionId))
      .limit(1);
    const userId = associationRows[0]?.userId ?? null;
    await transaction
      .insert(matchPlayers)
      .values({
        matchId,
        playerSlotId: player.slotId,
        playerSessionId: player.playerSessionId,
        userId,
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
      stored.userId !== userId
    ) {
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }
}

function parseHistoryRow(row: {
  readonly matchId: string;
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

export class PostgresMatchRepository {
  public constructor(private readonly database: OnlineGameHubDatabase) {}

  public async recordRoomCreated(room: StoredGameRoom): Promise<void> {
    if (
      !validStoredRoom(room) ||
      room.status !== "waiting" ||
      room.revision !== 0
    ) {
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
    try {
      await this.database.transaction(async (transaction) => {
        const replayRows = await transaction
          .select({
            gameId: replays.gameId,
            gameVersion: replays.gameVersion,
          })
          .from(replays)
          .where(eq(replays.id, room.replayId))
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

        await transaction
          .insert(matches)
          .values({
            id: randomUUID(),
            runtimeRoomId: room.roomId,
            replayId: room.replayId,
            gameId: room.gameId,
            gameVersion: room.gameVersion,
            status: "waiting",
            finalRevision: 0,
          })
          .onConflictDoNothing();
        const matchRows = await transaction
          .select()
          .from(matches)
          .where(eq(matches.runtimeRoomId, room.roomId))
          .for("update")
          .limit(1);
        const match = matchRows[0];
        if (
          match === undefined ||
          match.replayId !== room.replayId ||
          match.gameId !== room.gameId ||
          match.gameVersion !== room.gameVersion
        ) {
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }
        await recordAssignedPlayers(transaction, match.id, room);
      });
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  public async recordRoomSaved(room: StoredGameRoom): Promise<void> {
    if (!validStoredRoom(room)) {
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
    try {
      await this.database.transaction(async (transaction) => {
        const matchRows = await transaction
          .select()
          .from(matches)
          .where(eq(matches.runtimeRoomId, room.roomId))
          .for("update")
          .limit(1);
        const match = matchRows[0];
        if (
          match === undefined ||
          match.replayId !== room.replayId ||
          match.gameId !== room.gameId ||
          match.gameVersion !== room.gameVersion ||
          room.revision < match.finalRevision
        ) {
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }
        await recordAssignedPlayers(transaction, match.id, room);

        if (room.status === "completed") {
          if (
            match.status !== "completed" ||
            match.completedAt === null ||
            match.finalRevision !== room.revision
          ) {
            throw new DatabaseError("DATABASE_OPERATION_ERROR");
          }
          return;
        }
        if (
          match.status === "completed" ||
          (match.status === "abandoned" && room.status !== "abandoned")
        ) {
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }

        if (room.status === "active") {
          await transaction
            .update(matches)
            .set({
              status: "active",
              finalRevision: room.revision,
              startedAt: match.startedAt ?? new Date(),
            })
            .where(eq(matches.id, match.id));
          return;
        }
        if (room.status === "abandoned") {
          await transaction
            .update(matches)
            .set({
              status: "abandoned",
              finalRevision: room.revision,
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

  public async listForGuest(
    playerSessionId: string,
    limit = MAX_MATCH_HISTORY_RESULTS,
  ): Promise<readonly MatchHistoryItem[]> {
    if (playerSessionId.length === 0) {
      throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
    }
    return this.#list(eq(matchPlayers.playerSessionId, playerSessionId), limit);
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

  public async getForGuest(
    playerSessionId: string,
    matchId: string,
  ): Promise<MatchHistoryItem | null> {
    if (playerSessionId.length === 0 || !validUuid(matchId)) return null;
    const identityCondition = and(
      eq(matchPlayers.playerSessionId, playerSessionId),
      eq(matches.id, matchId),
    );
    if (identityCondition === undefined) {
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
    const rows = await this.#historyRows(identityCondition, 1);
    return rows[0] ?? null;
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

export class PostgresMatchArchiveRoomStore implements RoomStore {
  readonly #delegate: RoomStore;

  public constructor(
    private readonly repository: PostgresMatchRepository,
    delegate: RoomStore = new InMemoryRoomStore(),
  ) {
    this.#delegate = delegate;
  }

  public async create(room: StoredGameRoom): Promise<void> {
    await this.#delegate.create(room);
    await this.repository.recordRoomCreated(room);
  }

  public async save(room: StoredGameRoom): Promise<void> {
    await this.repository.recordRoomSaved(room);
    await this.#delegate.save(room);
  }

  public getByRoomId(roomId: string) {
    return this.#delegate.getByRoomId(roomId);
  }

  public getByRoomCode(roomCode: string) {
    return this.#delegate.getByRoomCode(roomCode);
  }

  public list() {
    return this.#delegate.list();
  }
}
