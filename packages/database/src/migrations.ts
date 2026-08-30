import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import type { PostgresDatabaseClient } from "./client.js";
import { DatabaseError } from "./errors.js";

export const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../drizzle", import.meta.url),
);

export interface ApplyDatabaseMigrationsOptions {
  readonly migrationsFolder?: string;
  readonly migrationsSchema?: string;
}

export async function applyDatabaseMigrations(
  client: PostgresDatabaseClient,
  options: ApplyDatabaseMigrationsOptions = {},
): Promise<void> {
  try {
    await migrate(client.database, {
      migrationsFolder:
        options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER,
      migrationsSchema: options.migrationsSchema ?? "drizzle",
      migrationsTable: "__drizzle_migrations",
    });
  } catch {
    throw new DatabaseError("DATABASE_MIGRATION_ERROR");
  }
}
