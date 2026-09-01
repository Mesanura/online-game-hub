import { createHmac } from "node:crypto";

import {
  GAME_SERVER_TICKET_AUDIENCE,
  PROTOCOL_VERSION,
} from "@online-game-hub/protocol";
import { describe, expect, it } from "vitest";

import { createHmacGameServerTicketAuthority } from "../src/index.js";

const SECRET = "ticket-secret-with-at-least-32-bytes";

function encodeUnsafeClaims(claims: unknown): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

describe("HMAC Game Server ticket authority", () => {
  it("issues short-lived Protocol V3 claims controlled by the server", () => {
    const authority = createHmacGameServerTicketAuthority({
      issuer: "web-test",
      secret: SECRET,
      lifetimeSeconds: 30,
      time: { nowSeconds: () => 100 },
      ids: { createTicketId: () => "ticket-1" },
    });
    const ticket = authority.issue("session-a");
    expect(authority.verify(ticket)).toEqual({
      status: "verified",
      claims: {
        issuer: "web-test",
        audience: GAME_SERVER_TICKET_AUDIENCE,
        playerSessionId: "session-a",
        issuedAt: 100,
        expiresAt: 130,
        ticketId: "ticket-1",
        protocolVersion: PROTOCOL_VERSION,
      },
    });
    expect(ticket).not.toContain(SECRET);
  });

  it.each([
    [undefined, "MISSING_TICKET"],
    ["", "MISSING_TICKET"],
    ["not-a-ticket", "INVALID_TICKET"],
    ["a.b.c", "INVALID_TICKET"],
  ] as const)("rejects malformed input %#", (ticket, code) => {
    const authority = createHmacGameServerTicketAuthority({
      issuer: "web-test",
      secret: SECRET,
      time: { nowSeconds: () => 100 },
    });
    expect(authority.verify(ticket)).toEqual({ status: "rejected", code });
  });

  it("rejects tampering, wrong issuer/audience/version, future issue, and expiry", () => {
    const authority = createHmacGameServerTicketAuthority({
      issuer: "web-test",
      secret: SECRET,
      time: { nowSeconds: () => 100 },
    });
    const validClaims = {
      issuer: "web-test",
      audience: GAME_SERVER_TICKET_AUDIENCE,
      playerSessionId: "session-a",
      issuedAt: 90,
      expiresAt: 110,
      ticketId: "ticket-1",
      protocolVersion: PROTOCOL_VERSION,
    };
    expect(authority.verify(`${encodeUnsafeClaims(validClaims)}x`)).toEqual({
      status: "rejected",
      code: "INVALID_TICKET",
    });
    expect(
      authority.verify(
        encodeUnsafeClaims({ ...validClaims, issuer: "another-web" }),
      ),
    ).toEqual({ status: "rejected", code: "WRONG_ISSUER" });
    expect(
      authority.verify(
        encodeUnsafeClaims({ ...validClaims, audience: "another-service" }),
      ),
    ).toEqual({ status: "rejected", code: "WRONG_AUDIENCE" });
    expect(
      authority.verify(
        encodeUnsafeClaims({ ...validClaims, protocolVersion: 1 }),
      ),
    ).toEqual({
      status: "rejected",
      code: "PROTOCOL_VERSION_UNSUPPORTED",
    });
    expect(
      authority.verify(
        encodeUnsafeClaims({ ...validClaims, issuedAt: 101, expiresAt: 110 }),
      ),
    ).toEqual({ status: "rejected", code: "INVALID_TICKET" });
    expect(
      authority.verify(
        encodeUnsafeClaims({ ...validClaims, issuedAt: 90, expiresAt: 100 }),
      ),
    ).toEqual({ status: "rejected", code: "EXPIRED_TICKET" });
  });

  it("requires explicit secure configuration", () => {
    expect(() =>
      createHmacGameServerTicketAuthority({
        issuer: "",
        secret: SECRET,
      }),
    ).toThrow(/issuer/u);
    expect(() =>
      createHmacGameServerTicketAuthority({
        issuer: "web-test",
        secret: "too-short",
      }),
    ).toThrow(/32/u);
    expect(() =>
      createHmacGameServerTicketAuthority({
        issuer: "web-test",
        secret: SECRET,
        lifetimeSeconds: 301,
      }),
    ).toThrow(/1 to 300/u);
  });
});
