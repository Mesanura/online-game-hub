import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { OnlineGameHubDatabase } from "./client.js";
import { DatabaseError } from "./errors.js";
import { users } from "./schema.js";

export interface UserRecord {
  readonly userId: string;
  readonly createdAt: string;
}

export class PostgresUserRepository {
  public constructor(private readonly database: OnlineGameHubDatabase) {}

  public async createUser(): Promise<UserRecord> {
    try {
      const rows = await this.database
        .insert(users)
        .values({ id: randomUUID(), displayName: "游客" })
        .returning({ id: users.id, createdAt: users.createdAt });
      const row = rows[0];
      if (row === undefined)
        throw new DatabaseError("DATABASE_OPERATION_ERROR");
      return { userId: row.id, createdAt: row.createdAt.toISOString() };
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
  }

  public async getUser(userId: string): Promise<UserRecord | null> {
    if (!/^[0-9a-f-]{36}$/iu.test(userId)) return null;
    const rows = await this.database
      .select({ id: users.id, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? null
      : { userId: row.id, createdAt: row.createdAt.toISOString() };
  }
}
