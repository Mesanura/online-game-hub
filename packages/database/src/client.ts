import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { DatabaseError } from "./errors.js";
import { databaseSchema } from "./schema.js";

export type OnlineGameHubDatabase = PostgresJsDatabase<typeof databaseSchema>;

export interface PostgresDatabaseClientOptions {
  readonly url: string;
  readonly applicationName: string;
  readonly maxConnections?: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
}

export interface PostgresDatabaseClient {
  readonly database: OnlineGameHubDatabase;
  close(): Promise<void>;
}

function validateOptions(options: PostgresDatabaseClientOptions): void {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    url.hostname.length === 0 ||
    options.applicationName.length === 0
  ) {
    throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
  }
  for (const value of [
    options.maxConnections ?? 10,
    options.idleTimeoutSeconds ?? 20,
    options.connectTimeoutSeconds ?? 10,
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
    }
  }
}

export function createPostgresDatabaseClient(
  options: PostgresDatabaseClientOptions,
): PostgresDatabaseClient {
  validateOptions(options);
  const driver = postgres(options.url, {
    connection: { application_name: options.applicationName },
    max: options.maxConnections ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 20,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    onnotice: () => undefined,
  });
  const database = drizzle(driver, { schema: databaseSchema });
  let closed = false;

  return {
    database,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await driver.end({ timeout: 5 });
      } catch {
        throw new DatabaseError("DATABASE_CONNECTION_ERROR");
      }
    },
  };
}
