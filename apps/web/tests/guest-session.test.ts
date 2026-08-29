import { describe, expect, it } from "vitest";

import {
  GUEST_SESSION_COOKIE_NAME,
  createGuestSessionAuthority,
  guestSessionCookieOptions,
  resolveGuestSession,
} from "../src/server/guest-session.js";

const SECRET = "guest-session-secret-at-least-32-bytes";

describe("anonymous guest session", () => {
  it("creates and verifies a server-controlled signed PlayerSessionId", () => {
    const authority = createGuestSessionAuthority({
      secret: SECRET,
      time: { nowSeconds: () => 100 },
      ids: { createPlayerSessionId: () => "guest-session-a" },
    });
    const created = authority.create();
    expect(authority.verify(created.token)).toEqual({
      status: "verified",
      playerSessionId: "guest-session-a",
    });
    expect(created.token).not.toContain(SECRET);
    expect(authority.verify(`${created.token}tampered`)).toEqual({
      status: "rejected",
    });
  });

  it("reuses a valid cookie and replaces invalid or expired cookies", () => {
    let now = 100;
    let sequence = 0;
    const authority = createGuestSessionAuthority({
      secret: SECRET,
      time: { nowSeconds: () => now },
      ids: { createPlayerSessionId: () => `guest-${++sequence}` },
      maxAgeSeconds: 10,
    });
    const first = resolveGuestSession(undefined, authority);
    expect(first).toMatchObject({
      playerSessionId: "guest-1",
      cookieValueToSet: expect.any(String),
    });
    expect(resolveGuestSession(first.cookieValueToSet, authority)).toEqual({
      playerSessionId: "guest-1",
      cookieValueToSet: null,
    });
    now = 110;
    expect(
      resolveGuestSession(first.cookieValueToSet, authority),
    ).toMatchObject({
      playerSessionId: "guest-2",
      cookieValueToSet: expect.any(String),
    });
  });

  it("uses HttpOnly, SameSite, path-wide, explicitly Secure cookie semantics", () => {
    expect(GUEST_SESSION_COOKIE_NAME).toBe("ogh_guest");
    expect(guestSessionCookieOptions(true)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
    expect(guestSessionCookieOptions(false)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    });
  });

  it("rejects weak secrets and cookies signed by another deployment", () => {
    expect(() => createGuestSessionAuthority({ secret: "weak" })).toThrow(
      /32/u,
    );
    const first = createGuestSessionAuthority({
      secret: SECRET,
      time: { nowSeconds: () => 100 },
      ids: { createPlayerSessionId: () => "guest-a" },
    });
    const second = createGuestSessionAuthority({
      secret: "another-guest-session-secret-at-least-32-bytes",
      time: { nowSeconds: () => 100 },
    });
    expect(second.verify(first.create().token)).toEqual({ status: "rejected" });
  });
});
