import { randomUUID } from "node:crypto";

import { and, eq, gt, ne } from "drizzle-orm";

import type { OnlineGameHubDatabase } from "./client.js";
import { DatabaseError } from "./errors.js";
import { accountSessions, passwordCredentials, users } from "./schema.js";

export type AccountRepositoryErrorCode =
  "USERNAME_UNAVAILABLE" | "SESSION_TOKEN_CONFLICT" | "ACCOUNT_STATE_CONFLICT";

export class AccountRepositoryError extends Error {
  public constructor(public readonly code: AccountRepositoryErrorCode) {
    super(code);
    this.name = "AccountRepositoryError";
  }
}

export interface PasswordAccountRecord {
  readonly userId: string;
  readonly username: string;
  readonly passwordHash: string;
}

export interface AccountSessionRecord {
  readonly sessionId: string;
  readonly userId: string;
  readonly username: string;
  readonly tokenHash: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface NewAccountSession {
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/u;

function validPasswordHash(value: string): boolean {
  return value.length > 0 && value.length <= 1024;
}

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function parseSession(row: {
  readonly sessionId: string;
  readonly userId: string;
  readonly username: string;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}): AccountSessionRecord {
  if (
    !UUID_PATTERN.test(row.sessionId) ||
    !UUID_PATTERN.test(row.userId) ||
    !USERNAME_PATTERN.test(row.username) ||
    !TOKEN_HASH_PATTERN.test(row.tokenHash) ||
    !validDate(row.createdAt) ||
    !validDate(row.expiresAt) ||
    row.expiresAt.getTime() <= row.createdAt.getTime()
  ) {
    throw new DatabaseError("DATABASE_DATA_INVALID");
  }
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

function assertCredentialInput(username: string, passwordHash: string): void {
  if (!USERNAME_PATTERN.test(username) || !validPasswordHash(passwordHash)) {
    throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
  }
}

function assertSessionInput(session: NewAccountSession): void {
  if (
    !TOKEN_HASH_PATTERN.test(session.tokenHash) ||
    !validDate(session.expiresAt)
  ) {
    throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
  }
}

export class PostgresAccountRepository {
  public constructor(private readonly database: OnlineGameHubDatabase) {}

  public async registerPasswordAccount(
    username: string,
    passwordHash: string,
    session: NewAccountSession,
  ): Promise<AccountSessionRecord> {
    assertCredentialInput(username, passwordHash);
    assertSessionInput(session);
    try {
      return await this.database.transaction(async (transaction) => {
        const userId = randomUUID();
        await transaction.insert(users).values({ id: userId });
        const credentials = await transaction
          .insert(passwordCredentials)
          .values({ userId, username, passwordHash })
          .onConflictDoNothing({ target: passwordCredentials.username })
          .returning({ userId: passwordCredentials.userId });
        if (credentials[0] === undefined) {
          throw new AccountRepositoryError("USERNAME_UNAVAILABLE");
        }
        return await this.#insertSession(
          transaction,
          userId,
          username,
          session,
        );
      });
    } catch (error) {
      if (
        error instanceof AccountRepositoryError ||
        error instanceof DatabaseError
      ) {
        throw error;
      }
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  public async findPasswordAccountByUsername(
    username: string,
  ): Promise<PasswordAccountRecord | null> {
    if (!USERNAME_PATTERN.test(username)) return null;
    try {
      const rows = await this.database
        .select({
          userId: passwordCredentials.userId,
          username: passwordCredentials.username,
          passwordHash: passwordCredentials.passwordHash,
        })
        .from(passwordCredentials)
        .where(eq(passwordCredentials.username, username))
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      if (
        !UUID_PATTERN.test(row.userId) ||
        !validPasswordHash(row.passwordHash)
      ) {
        throw new DatabaseError("DATABASE_DATA_INVALID");
      }
      return row;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  public async createAccountSession(
    userId: string,
    session: NewAccountSession,
  ): Promise<AccountSessionRecord> {
    if (!UUID_PATTERN.test(userId)) {
      throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
    }
    assertSessionInput(session);
    try {
      return await this.database.transaction(async (transaction) => {
        const credentialRows = await transaction
          .select({ username: passwordCredentials.username })
          .from(passwordCredentials)
          .where(eq(passwordCredentials.userId, userId))
          .limit(1);
        const credential = credentialRows[0];
        if (credential === undefined) {
          throw new AccountRepositoryError("ACCOUNT_STATE_CONFLICT");
        }
        return await this.#insertSession(
          transaction,
          userId,
          credential.username,
          session,
        );
      });
    } catch (error) {
      if (
        error instanceof AccountRepositoryError ||
        error instanceof DatabaseError
      ) {
        throw error;
      }
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  public async resolveAccountSession(
    tokenHash: string,
    now: Date,
  ): Promise<AccountSessionRecord | null> {
    if (!TOKEN_HASH_PATTERN.test(tokenHash) || !validDate(now)) return null;
    try {
      const rows = await this.database
        .select({
          sessionId: accountSessions.id,
          userId: accountSessions.userId,
          username: passwordCredentials.username,
          tokenHash: accountSessions.tokenHash,
          createdAt: accountSessions.createdAt,
          expiresAt: accountSessions.expiresAt,
        })
        .from(accountSessions)
        .innerJoin(
          passwordCredentials,
          eq(passwordCredentials.userId, accountSessions.userId),
        )
        .where(
          and(
            eq(accountSessions.tokenHash, tokenHash),
            gt(accountSessions.expiresAt, now),
          ),
        )
        .limit(1);
      return rows[0] === undefined ? null : parseSession(rows[0]);
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  public async deleteAccountSession(tokenHash: string): Promise<void> {
    if (!TOKEN_HASH_PATTERN.test(tokenHash)) return;
    try {
      await this.database
        .delete(accountSessions)
        .where(eq(accountSessions.tokenHash, tokenHash));
    } catch {
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  public async changePasswordAndRevokeOtherSessions(
    userId: string,
    expectedPasswordHash: string,
    newPasswordHash: string,
    currentTokenHash: string,
  ): Promise<void> {
    if (
      !UUID_PATTERN.test(userId) ||
      !validPasswordHash(expectedPasswordHash) ||
      !validPasswordHash(newPasswordHash) ||
      !TOKEN_HASH_PATTERN.test(currentTokenHash)
    ) {
      throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
    }
    try {
      await this.database.transaction(async (transaction) => {
        const credentialRows = await transaction
          .select({ passwordHash: passwordCredentials.passwordHash })
          .from(passwordCredentials)
          .where(eq(passwordCredentials.userId, userId))
          .for("update")
          .limit(1);
        const currentSessionRows = await transaction
          .select({ id: accountSessions.id })
          .from(accountSessions)
          .where(
            and(
              eq(accountSessions.userId, userId),
              eq(accountSessions.tokenHash, currentTokenHash),
            ),
          )
          .for("update")
          .limit(1);
        if (
          credentialRows[0]?.passwordHash !== expectedPasswordHash ||
          currentSessionRows[0] === undefined
        ) {
          throw new AccountRepositoryError("ACCOUNT_STATE_CONFLICT");
        }
        await transaction
          .update(passwordCredentials)
          .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
          .where(eq(passwordCredentials.userId, userId));
        await transaction
          .delete(accountSessions)
          .where(
            and(
              eq(accountSessions.userId, userId),
              ne(accountSessions.tokenHash, currentTokenHash),
            ),
          );
      });
    } catch (error) {
      if (
        error instanceof AccountRepositoryError ||
        error instanceof DatabaseError
      ) {
        throw error;
      }
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  async #insertSession(
    transaction: Parameters<
      Parameters<OnlineGameHubDatabase["transaction"]>[0]
    >[0],
    userId: string,
    username: string,
    session: NewAccountSession,
  ): Promise<AccountSessionRecord> {
    const rows = await transaction
      .insert(accountSessions)
      .values({
        id: randomUUID(),
        userId,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
      })
      .onConflictDoNothing({ target: accountSessions.tokenHash })
      .returning({
        sessionId: accountSessions.id,
        tokenHash: accountSessions.tokenHash,
        createdAt: accountSessions.createdAt,
        expiresAt: accountSessions.expiresAt,
      });
    const row = rows[0];
    if (row === undefined) {
      throw new AccountRepositoryError("SESSION_TOKEN_CONFLICT");
    }
    return parseSession({ ...row, userId, username });
  }
}
