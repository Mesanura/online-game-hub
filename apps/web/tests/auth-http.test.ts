import { describe, expect, it } from "vitest";

import { AuthRateLimiter } from "../src/server/auth-rate-limit.js";
import {
  authRequestSchema,
  isJsonRequest,
  isSameOrigin,
  readJsonBody,
} from "../src/server/http-auth.js";

describe("account HTTP security boundary", () => {
  it("requires an exact same-origin request", () => {
    expect(
      isSameOrigin(
        new Request("https://games.example.test/api/auth/login", {
          headers: { origin: "https://games.example.test" },
        }),
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        new Request("https://games.example.test/api/auth/login", {
          headers: { origin: "https://attacker.example.test" },
        }),
      ),
    ).toBe(false);
    expect(
      isSameOrigin(
        new Request("https://localhost/api/auth/login", {
          headers: {
            host: "games.example.test",
            origin: "https://games.example.test",
          },
        }),
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        new Request("https://localhost/api/auth/login", {
          headers: {
            host: "games.example.test",
            origin: "http://games.example.test",
          },
        }),
      ),
    ).toBe(false);
    expect(
      isSameOrigin(new Request("https://games.example.test/api/auth/login")),
    ).toBe(false);
  });

  it("accepts JSON with an optional charset and rejects other media types", () => {
    expect(
      isJsonRequest(
        new Request("https://games.example.test/api/auth/login", {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      ),
    ).toBe(true);
    expect(
      isJsonRequest(
        new Request("https://games.example.test/api/auth/login", {
          headers: { "content-type": "text/plain" },
        }),
      ),
    ).toBe(false);
  });

  it("bounds input and enforces strict fields", async () => {
    const valid = new Request("https://games.example.test/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "alice", password: "x".repeat(12) }),
    });
    expect(authRequestSchema.safeParse(await readJsonBody(valid)).success).toBe(
      true,
    );
    expect(
      authRequestSchema.safeParse({
        username: "alice",
        password: "x".repeat(12),
        userId: "forged",
      }).success,
    ).toBe(false);
    const oversized = new Request("https://games.example.test/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: "x".repeat(5000) }),
    });
    await expect(readJsonBody(oversized)).resolves.toBeNull();
  });
});

describe("bounded single-instance auth rate limiter", () => {
  it("limits a key, resets by window, and evicts to its fixed bound", () => {
    let now = 0;
    const limiter = new AuthRateLimiter({
      limit: 2,
      windowMilliseconds: 1000,
      maxEntries: 2,
      clock: { nowMilliseconds: () => now },
    });
    expect(limiter.consume("login:a")).toBe(true);
    expect(limiter.consume("login:a")).toBe(true);
    expect(limiter.consume("login:a")).toBe(false);
    expect(limiter.consume("login:b")).toBe(true);
    expect(limiter.consume("login:c")).toBe(true);
    expect(limiter.size).toBe(2);
    now = 1000;
    expect(limiter.consume("login:a")).toBe(true);
  });
});
