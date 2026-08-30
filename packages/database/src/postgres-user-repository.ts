import { randomUUID } from "node:crypto";

import {
  and,
  eq,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";

import type { OnlineGameHubDatabase } from "./client.js";
import { DatabaseError } from "./errors.js";
import {
  guestUserAssociations,
  matchPlayers,
  users,
} from "./schema.js";

export type GuestAssociationErrorCode =
  | "USER_NOT_FOUND"
  | "GUEST_ASSOCIATION_CONFLICT";

export class GuestAssociationError extends Error {
  public constructor(public readonly code: GuestAssociationErrorCode) {
    super(code);
    this.name = "GuestAssociationError";
  }
}

export interface UserRecord {
  readonly userId: string;
  readonly createdAt: string;
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function parseUser(row: {
  readonly id: string;
  readonly createdAt: Date;
}): UserRecord {
  if (
    !validUuid(row.id) ||
    !(row.createdAt instanceof Date) ||
    !Number.isFinite(row.createdAt.getTime())
  ) {
    throw new DatabaseError("DATABASE_DATA_INVALID");
  }
  return { userId: row.id, createdAt: row.createdAt.toISOString() };
}

export class PostgresUserRepository {
  public constructor(private readonly database: OnlineGameHubDatabase) {}

  public async createUser(): Promise<UserRecord> {
    try {
      const rows = await this.database
        .insert(users)
        .values({ id: randomUUID() })
        .returning({ id: users.id, createdAt: users.createdAt });
      const row = rows[0];
      if (row === undefined) {
        throw new DatabaseError("DATABASE_OPERATION_ERROR");
      }
      return parseUser(row);
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  public async getUser(userId: string): Promise<UserRecord | null> {
    if (!validUuid(userId)) return null;
    try {
      const rows = await this.database
        .select({ id: users.id, createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0] === undefined ? null : parseUser(rows[0]);
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  public async associateGuestWithUser(
    playerSessionId: string,
    trustedUserId: string,
  ): Promise<void> {
    if (playerSessionId.length === 0 || !validUuid(trustedUserId)) {
      throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
    }
    try {
      await this.database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${playerSessionId}, 0))`,
        );
        const userRows = await transaction
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, trustedUserId))
          .for("update")
          .limit(1);
        if (userRows[0] === undefined) {
          throw new GuestAssociationError("USER_NOT_FOUND");
        }

        await transaction
          .insert(guestUserAssociations)
          .values({ playerSessionId, userId: trustedUserId })
          .onConflictDoNothing({
            target: guestUserAssociations.playerSessionId,
          });
        const associationRows = await transaction
          .select({ userId: guestUserAssociations.userId })
          .from(guestUserAssociations)
          .where(
            eq(
              guestUserAssociations.playerSessionId,
              playerSessionId,
            ),
          )
          .for("update")
          .limit(1);
        const association = associationRows[0];
        if (
          association === undefined ||
          association.userId !== trustedUserId
        ) {
          throw new GuestAssociationError(
            "GUEST_ASSOCIATION_CONFLICT",
          );
        }

        const conflictingPlayers = await transaction
          .select({ matchId: matchPlayers.matchId })
          .from(matchPlayers)
          .where(
            and(
              eq(matchPlayers.playerSessionId, playerSessionId),
              isNotNull(matchPlayers.userId),
              ne(matchPlayers.userId, trustedUserId),
            ),
          )
          .limit(1);
        if (conflictingPlayers[0] !== undefined) {
          throw new GuestAssociationError(
            "GUEST_ASSOCIATION_CONFLICT",
          );
        }
        await transaction
          .update(matchPlayers)
          .set({ userId: trustedUserId })
          .where(
            and(
              eq(matchPlayers.playerSessionId, playerSessionId),
              isNull(matchPlayers.userId),
            ),
          );
      });
    } catch (error) {
      if (
        error instanceof GuestAssociationError ||
        error instanceof DatabaseError
      ) {
        throw error;
      }
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }
}
