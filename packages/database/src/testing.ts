import { randomBytes } from "node:crypto";

import postgres from "postgres";

import {
  applyDatabaseMigrations,
  createPostgresDatabaseClient,
} from "./index.js";
import type { PostgresDatabaseClient } from "./index.js";
import { DatabaseError } from "./errors.js";

const TEST_DATABASE_PREFIX = "ogh_test_";
const TEST_DATABASE_PATTERN = /^ogh_test_[0-9a-f]{24}$/u;

export interface IsolatedTestDatabase {
  readonly databaseName: string;
  readonly url: string;
  readonly client: PostgresDatabaseClient;
  close(): Promise<void>;
}

function databaseUrl(baseUrl: string, databaseName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
  }
  if (
    (parsed.protocol !== "postgres:" &&
      parsed.protocol !== "postgresql:") ||
    parsed.hostname.length === 0
  ) {
    throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
  }
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

export async function createIsolatedTestDatabase(
  baseUrl: string,
): Promise<IsolatedTestDatabase> {
  const databaseName =
    TEST_DATABASE_PREFIX + randomBytes(12).toString("hex");
  if (!TEST_DATABASE_PATTERN.test(databaseName)) {
    throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
  }
  const admin = postgres(baseUrl, {
    connection: {
      application_name: "online-game-hub-database-test-admin",
    },
    max: 1,
    onnotice: () => undefined,
  });
  let client: PostgresDatabaseClient | undefined;
  let created = false;
  try {
    await admin`create database ${admin(databaseName)}`;
    created = true;
    const url = databaseUrl(baseUrl, databaseName);
    client = createPostgresDatabaseClient({
      url,
      applicationName: "online-game-hub-database-test",
      maxConnections: 4,
    });
    await applyDatabaseMigrations(client);
    let closed = false;
    return {
      databaseName,
      url,
      client,
      async close() {
        if (closed) return;
        closed = true;
        await client?.close();
        if (!TEST_DATABASE_PATTERN.test(databaseName)) {
          throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
        }
        await admin`drop database ${admin(databaseName)} with (force)`;
        await admin.end({ timeout: 5 });
      },
    };
  } catch (error) {
    await client?.close().catch(() => undefined);
    if (created && TEST_DATABASE_PATTERN.test(databaseName)) {
      await admin`drop database ${admin(databaseName)} with (force)`.catch(
        () => undefined,
      );
    }
    await admin.end({ timeout: 5 }).catch(() => undefined);
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError("DATABASE_OPERATION_ERROR");
  }
}

export function requireTestDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const url = environment.TEST_DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
  }
  return url;
}
