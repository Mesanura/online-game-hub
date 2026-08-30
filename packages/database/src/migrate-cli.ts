import {
  applyDatabaseMigrations,
  createPostgresDatabaseClient,
} from "./index.js";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    process.stderr.write(
      `${JSON.stringify({ event: "database.migration_failed", code: "DATABASE_CONFIGURATION_ERROR" })}\n`,
    );
    process.exitCode = 1;
    return;
  }

  let client: ReturnType<typeof createPostgresDatabaseClient> | undefined;
  try {
    client = createPostgresDatabaseClient({
      url,
      applicationName: "online-game-hub-migration",
      maxConnections: 1,
    });
    await applyDatabaseMigrations(client);
    process.stdout.write(`${JSON.stringify({ event: "database.migrated" })}\n`);
  } catch {
    process.stderr.write(
      `${JSON.stringify({ event: "database.migration_failed", code: "DATABASE_MIGRATION_ERROR" })}\n`,
    );
    process.exitCode = 1;
  } finally {
    await client?.close().catch(() => {
      process.exitCode = 1;
    });
  }
}

await main();
