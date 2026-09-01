import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";

import {
  ACCOUNT_SESSION_COOKIE_NAME,
  ACCOUNT_SESSION_MAX_AGE_SECONDS,
  accountSessionCookieOptions,
  createAccountSessionMaterial,
  hashAccountSessionToken,
} from "../src/server/account-session.js";
import {
  clearAuthenticatedCookies,
  setAuthenticatedCookies,
} from "../src/server/auth-response.js";
import type { WebServerConfig } from "../src/server/config.js";

const config = {
  guestSessionSecret: "test-guest-session-secret-at-least-32-bytes",
  guestCookieSecure: true,
} as WebServerConfig;

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

  it("rotates guest identity on authentication and session invalidation", () => {
    const authenticated = NextResponse.json({ ok: true });
    setAuthenticatedCookies(
      authenticated,
      config,
      "opaque-account-session-token-with-enough-entropy",
    );
    const authenticatedCookies = authenticated.headers.get("set-cookie") ?? "";
    expect(authenticatedCookies).toContain("ogh_account=");
    expect(authenticatedCookies).toContain("ogh_guest=");
    expect(authenticatedCookies).toContain("HttpOnly");
    expect(authenticatedCookies).toContain("SameSite=lax");
    expect(authenticatedCookies).toContain("Secure");
    expect(authenticatedCookies).toContain("Path=/");

    const invalidated = NextResponse.json({ ok: true });
    clearAuthenticatedCookies(invalidated, config);
    const invalidatedCookies = invalidated.headers.get("set-cookie") ?? "";
    expect(invalidatedCookies).toContain("ogh_account=");
    expect(invalidatedCookies).toContain("Max-Age=0");
    expect(invalidatedCookies).toContain("ogh_guest=");
  });
});
