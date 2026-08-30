import { describe, expect, it } from "vitest";

import {
  DatabaseError,
  createPostgresDatabaseClient,
} from "../src/index.js";

describe("PostgreSQL client configuration", () => {
  it("creates an explicit closable client without connecting on import", async () => {
    const client = createPostgresDatabaseClient({
      url: "postgresql://test:test@127.0.0.1:1/unreachable",
      applicationName: "database-unit-test",
      maxConnections: 1,
    });
    await expect(client.close()).resolves.toBeUndefined();
    await expect(client.close()).resolves.toBeUndefined();
  });

  it.each([
    { url: "", applicationName: "app" },
    { url: "https://database.invalid/example", applicationName: "app" },
    { url: "postgresql:///missing-host", applicationName: "app" },
    { url: "postgresql://localhost/example", applicationName: "" },
    {
      url: "postgresql://localhost/example",
      applicationName: "app",
      maxConnections: 0,
    },
  ])("fails closed for invalid safe configuration %#", (options) => {
    expect(() => createPostgresDatabaseClient(options)).toThrowError(
      expect.objectContaining<Partial<DatabaseError>>({
        code: "DATABASE_CONFIGURATION_ERROR",
        message: "DATABASE_CONFIGURATION_ERROR",
      }),
    );
  });
});
