import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_SESSION_COOKIE_NAME,
  ACCOUNT_SESSION_MAX_AGE_SECONDS,
  accountSessionCookieOptions,
  createAccountSessionMaterial,
  hashAccountSessionToken,
} from "../src/server/account-session.js";

describe("account session token", () => {
  it("stores only a SHA-256 token hash and uses a 30-day absolute expiry", () => {
    const token = "opaque-account-session-token-with-enough-entropy";
    const now = new Date("2026-09-02T00:00:00.000Z");
    const material = createAccountSessionMaterial(now, {
      createToken: () => token,
    });
    expect(material).toEqual({
      token,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(
        now.getTime() + ACCOUNT_SESSION_MAX_AGE_SECONDS * 1000,
      ),
    });
    expect(material.tokenHash).not.toContain(token);
  });

  it("rejects malformed cookie tokens before hashing", () => {
    expect(hashAccountSessionToken(undefined)).toBeNull();
    expect(hashAccountSessionToken("short")).toBeNull();
    expect(hashAccountSessionToken("x".repeat(513))).toBeNull();
  });

  it("uses hardened path-wide cookie attributes", () => {
    expect(ACCOUNT_SESSION_COOKIE_NAME).toBe("ogh_account");
    expect(accountSessionCookieOptions(true)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: ACCOUNT_SESSION_MAX_AGE_SECONDS,
    });
    expect(accountSessionCookieOptions(false).secure).toBe(false);
  });
});
