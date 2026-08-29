import { describe, expect, it } from "vitest";

import { readWebServerConfig } from "../src/server/config.js";

const secureEnvironment = {
  APP_ENV: "production",
  GAME_SERVER_PUBLIC_URL: "https://games.example.test",
  GUEST_SESSION_SECRET: "guest-session-secret-at-least-32-bytes",
  GUEST_COOKIE_SECURE: "true",
  GAME_SERVER_TICKET_ISSUER: "web-production",
  GAME_SERVER_TICKET_SECRET: "game-ticket-secret-at-least-32-bytes",
  GAME_SERVER_TICKET_LIFETIME_SECONDS: "30",
} as const;

describe("Web server configuration", () => {
  it("requires explicit production secrets, issuer, public URL, and Secure cookie", () => {
    expect(readWebServerConfig(secureEnvironment)).toEqual({
      applicationEnvironment: "production",
      gameServerPublicUrl: "https://games.example.test",
      guestSessionSecret: secureEnvironment.GUEST_SESSION_SECRET,
      guestCookieSecure: true,
      ticketIssuer: "web-production",
      ticketSecret: secureEnvironment.GAME_SERVER_TICKET_SECRET,
      ticketLifetimeSeconds: 30,
    });
    expect(() =>
      readWebServerConfig({
        ...secureEnvironment,
        GUEST_COOKIE_SECURE: "false",
      }),
    ).toThrow(/must be Secure/u);
    expect(() =>
      readWebServerConfig({
        ...secureEnvironment,
        GAME_SERVER_PUBLIC_URL: "http://games.example.test",
      }),
    ).toThrow(/HTTPS/u);
  });

  it("allows explicit insecure localhost cookies only in development/test", () => {
    expect(
      readWebServerConfig({
        ...secureEnvironment,
        APP_ENV: "test",
        GAME_SERVER_PUBLIC_URL: "http://127.0.0.1:43210",
        GUEST_COOKIE_SECURE: "false",
      }),
    ).toMatchObject({
      applicationEnvironment: "test",
      guestCookieSecure: false,
      gameServerPublicUrl: "http://127.0.0.1:43210",
    });
  });

  it("fails closed for missing or invalid configuration", () => {
    expect(() =>
      readWebServerConfig({
        ...secureEnvironment,
        GAME_SERVER_TICKET_SECRET: "",
      }),
    ).toThrow(/GAME_SERVER_TICKET_SECRET/u);
    expect(() =>
      readWebServerConfig({
        ...secureEnvironment,
        GAME_SERVER_PUBLIC_URL: "file:///private/server",
      }),
    ).toThrow(/HTTP/u);
    expect(() =>
      readWebServerConfig({
        ...secureEnvironment,
        GAME_SERVER_TICKET_LIFETIME_SECONDS: "301",
      }),
    ).toThrow(/1 to 300/u);
  });
});
