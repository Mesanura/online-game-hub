import { matchMaker } from "@colyseus/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  configureGameServerCors,
  createProductionGameServer,
  readGameServerConfig,
} from "../src/index.js";
import type { GameServerApplication } from "../src/index.js";

const productionEnvironment = {
  APP_ENV: "production",
  DATABASE_MODE: "postgres",
  DATABASE_URL: "postgresql://app:secret@database.example.test/app",
  GAME_SERVER_HOST: "127.0.0.1",
  GAME_SERVER_PORT: "2567",
  GAME_SERVER_ALLOWED_WEB_ORIGINS: "https://web.example.test",
  GAME_SERVER_RECONNECT_GRACE_MILLISECONDS: "60000",
  GAME_SERVER_TICKET_ISSUER: "web-production",
  GAME_SERVER_TICKET_SECRET: "production-ticket-secret-at-least-32-bytes",
} as const;

describe.sequential("production Game Server configuration", () => {
  let application: GameServerApplication | undefined;

  afterEach(async () => {
    await application?.stop();
    application = undefined;
  });

  it("requires production secrets, HTTPS Web origins, and a fixed public port", () => {
    expect(readGameServerConfig(productionEnvironment)).toEqual({
      applicationEnvironment: "production",
      databaseMode: "postgres",
      databaseUrl: productionEnvironment.DATABASE_URL,
      hostname: "127.0.0.1",
      port: 2567,
      ticketIssuer: "web-production",
      ticketSecret: productionEnvironment.GAME_SERVER_TICKET_SECRET,
      allowedWebOrigins: ["https://web.example.test"],
      reconnectGraceMilliseconds: 60_000,
    });
    expect(() =>
      readGameServerConfig({
        ...productionEnvironment,
        GAME_SERVER_ALLOWED_WEB_ORIGINS: "http://web.example.test",
      }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      readGameServerConfig({
        ...productionEnvironment,
        GAME_SERVER_PORT: "0",
      }),
    ).toThrow(/1 to 65535/u);
    expect(() =>
      readGameServerConfig({
        ...productionEnvironment,
        DATABASE_MODE: "memory",
      }),
    ).toThrow(/PostgreSQL/u);
    expect(() =>
      readGameServerConfig({
        ...productionEnvironment,
        DATABASE_URL: "",
      }),
    ).toThrow(/DATABASE_URL/u);
  });

  it("allows only loopback HTTP and port zero in development/test", () => {
    expect(
      readGameServerConfig({
        ...productionEnvironment,
        APP_ENV: "test",
        DATABASE_MODE: "memory",
        GAME_SERVER_PORT: "0",
        GAME_SERVER_ALLOWED_WEB_ORIGINS: "http://127.0.0.1:43210",
      }),
    ).toMatchObject({
      applicationEnvironment: "test",
      databaseMode: "memory",
      databaseUrl: null,
      port: 0,
      allowedWebOrigins: ["http://127.0.0.1:43210"],
    });
    expect(() =>
      readGameServerConfig({
        ...productionEnvironment,
        APP_ENV: "development",
        DATABASE_MODE: "memory",
        GAME_SERVER_ALLOWED_WEB_ORIGINS: "http://192.0.2.1:3000",
      }),
    ).toThrow(/loopback/u);
  });

  it("reflects only configured browser origins and restores Colyseus defaults", () => {
    const restore = configureGameServerCors(["https://web.example.test"]);
    expect(
      matchMaker.controller.getCorsHeaders(
        new Headers({ origin: "https://web.example.test" }),
      ),
    ).toEqual({
      "Access-Control-Allow-Origin": "https://web.example.test",
      Vary: "Origin",
    });
    expect(
      matchMaker.controller.getCorsHeaders(
        new Headers({ origin: "https://attacker.example.test" }),
      ),
    ).toMatchObject({
      "Access-Control-Allow-Origin": "https://cors.invalid",
    });
    restore();
    expect(
      matchMaker.controller.getCorsHeaders(
        new Headers({ origin: "https://restored.example.test" }),
      ),
    ).toMatchObject({
      "Access-Control-Allow-Origin": "https://restored.example.test",
    });
  });

  it("starts a real Colyseus server with production auth and CORS adapters", async () => {
    const config = readGameServerConfig({
      ...productionEnvironment,
      APP_ENV: "test",
      DATABASE_MODE: "memory",
      GAME_SERVER_PORT: "0",
      GAME_SERVER_ALLOWED_WEB_ORIGINS: "http://127.0.0.1:43210",
    });
    application = createProductionGameServer(config);
    const address = await application.start();
    const allowed = await fetch(`${address.httpUrl}/health`, {
      method: "OPTIONS",
      headers: { origin: "http://127.0.0.1:43210" },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:43210",
    );
    const rejected = await fetch(`${address.httpUrl}/health`, {
      method: "OPTIONS",
      headers: { origin: "http://127.0.0.1:43211" },
    });
    expect(rejected.headers.get("access-control-allow-origin")).toBe(
      "https://cors.invalid",
    );
  });
});
