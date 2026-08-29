import { describe, expect, it } from "vitest";

import { createConsoleRuntimeLogger } from "../src/index.js";

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
});
