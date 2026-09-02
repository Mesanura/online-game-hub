import { describe, expect, it, vi } from "vitest";

describe("private replay API response boundary", () => {
  it("documents the recursive forbidden replay fields", () => {
    const forbidden = new Set([
      "replayId",
      "seed",
      "rng",
      "recordedOutcome",
      "state",
      "action",
      "actorSlotId",
      "playerSessionId",
      "userId",
      "runtimeRoomId",
      "participantRef",
    ]);
    const payload = {
      match: {
        roundNumber: 1,
        gameId: "tic-tac-toe",
        gameVersion: "1.1.0",
        status: "completed",
        finalRevision: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
      },
      frames: [{ revision: 0, view: { players: [] } }],
    };
    const found: string[] = [];
    const scan = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(scan);
      if (value !== null && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          if (forbidden.has(key)) found.push(key);
          scan(child);
        }
      }
    };
    scan(payload);
    expect(found).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain("replayId");
    expect(vi).toBeDefined();
  });
});
