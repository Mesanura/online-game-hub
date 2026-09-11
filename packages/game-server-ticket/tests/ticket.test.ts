import { createHmac } from "node:crypto";

import {
  GAME_SERVER_TICKET_AUDIENCE,
  SETUP_PROTOCOL_VERSION,
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
  it.each([6] as const)(
    "signs optional V%i public names without accepting tampering",
    (protocolVersion) => {
      const authority = createHmacGameServerTicketAuthority({
        issuer: "web-test",
        secret: SECRET,
      });
      const ticket = authority.issue(
        "session-a",
        undefined,
        protocolVersion,
        "👩‍💻玩家",
      );
      expect(authority.verify(ticket)).toMatchObject({
        status: "verified",
        claims: { displayName: "👩‍💻玩家" },
      });
      const [payload, signature] = ticket.split(".");
      if (payload === undefined || signature === undefined)
        throw new Error("Ticket segments are missing.");
      const claims = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      const altered = Buffer.from(
        JSON.stringify({ ...claims, displayName: "冒名" }),
      ).toString("base64url");
      expect(authority.verify(`${altered}.${signature}`)).toEqual({
        status: "rejected",
        code: "INVALID_TICKET",
      });
      expect(() =>
        authority.issue("session-a", undefined, protocolVersion, "bad\nname"),
      ).toThrow();
      expect(
        authority.verify(
          encodeUnsafeClaims({ ...claims, displayName: "bad\nname" }),
        ),
      ).toEqual({ status: "rejected", code: "INVALID_TICKET" });
    },
  );

  it("issues short-lived V6 guest and account claims controlled by the server", () => {
    const authority = createHmacGameServerTicketAuthority({
      issuer: "web-test",
      secret: SECRET,
      lifetimeSeconds: 30,
      time: { nowSeconds: () => 100 },
      ids: { createTicketId: () => "ticket-1" },
    });
    const ticket = authority.issue("session-a");
    expect(() => authority.issue("session-a", undefined, 5 as never)).toThrow();
    expect(authority.verify(ticket)).toEqual({
      status: "verified",
      claims: {
        issuer: "web-test",
        audience: GAME_SERVER_TICKET_AUDIENCE,
        playerSessionId: "session-a",
        issuedAt: 100,
        expiresAt: 130,
        ticketId: "ticket-1",
        protocolVersion: SETUP_PROTOCOL_VERSION,
      },
    });
    expect(ticket).not.toContain(SECRET);

    const accountTicket = authority.issue(
      "session-b",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(authority.verify(accountTicket)).toMatchObject({
      status: "verified",
      claims: {
        playerSessionId: "session-b",
        userId: "11111111-1111-4111-8111-111111111111",
        protocolVersion: SETUP_PROTOCOL_VERSION,
      },
    });

    const setupTicket = authority.issue(
      "session-c",
      undefined,
      SETUP_PROTOCOL_VERSION,
    );
    expect(authority.verify(setupTicket)).toMatchObject({
      status: "verified",
      claims: {
        playerSessionId: "session-c",
        protocolVersion: SETUP_PROTOCOL_VERSION,
      },
    });
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
      protocolVersion: SETUP_PROTOCOL_VERSION,
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
    for (const protocolVersion of [1, 2, 3, 4, 5, 7]) {
      expect(
        authority.verify(
          encodeUnsafeClaims({ ...validClaims, protocolVersion }),
        ),
      ).toEqual({
        status: "rejected",
        code: "PROTOCOL_VERSION_UNSUPPORTED",
      });
    }
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
