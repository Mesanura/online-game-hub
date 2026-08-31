import { describe, expect, it } from "vitest";

import { createHmacGameServerTicketAuthority } from "@online-game-hub/game-server-ticket";

import {
  createConsoleRuntimeLogger,
  createGameServerTicketVerifier,
} from "../src/index.js";

describe("game-server composition helpers", () => {
  it("writes one structured JSON log line without adding secret fields", () => {
    const lines: string[] = [];
    const logger = createConsoleRuntimeLogger((line) => lines.push(line));
    logger.write({
      event: "room.created",
      roomId: "room-1",
      gameId: "tic-tac-toe",
      gameVersion: "1.0.0",
      revision: 0,
      sessionCorrelationId: "session-deadbeef",
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "") as unknown).toEqual({
      event: "room.created",
      roomId: "room-1",
      gameId: "tic-tac-toe",
      gameVersion: "1.0.0",
      revision: 0,
      sessionCorrelationId: "session-deadbeef",
    });
    expect(lines[0]).not.toContain("ticket");
    expect(lines[0]).not.toContain("seed");
  });

  it("adapts the production HMAC authority without the testing subpath", async () => {
    const time = { nowSeconds: () => 100 };
    const secret = "production-ticket-secret-at-least-32-bytes";
    const authority = createHmacGameServerTicketAuthority({
      issuer: "web-production",
      secret,
      time,
      ids: { createTicketId: () => "ticket-1" },
    });
    const verifier = createGameServerTicketVerifier({
      issuer: "web-production",
      secret,
      time,
    });

    await expect(
      verifier.verify(authority.issue("session-a")),
    ).resolves.toMatchObject({
      status: "verified",
      playerSessionId: "session-a",
      claims: { issuer: "web-production", protocolVersion: 2 },
    });
    await expect(verifier.verify("tampered-ticket")).resolves.toEqual({
      status: "rejected",
      code: "INVALID_TICKET",
      protocolCode: "UNAUTHENTICATED",
    });
  });
});
