import { describe, expect, it } from "vitest";
import { countLiveRooms } from "../src/live-room-counts.js";

describe("live room generation counts", () => {
  it("reports both runtimes and never treats missing or damaged generation as drained", () => {
    expect(
      countLiveRooms([
        { name: "game", metadata: { setupProtocol: 5 } },
        { name: "game", metadata: { setupProtocol: 6 } },
        { name: "game" },
        { name: "realtime-game", metadata: { setupProtocol: 5 } },
        { name: "realtime-game", metadata: { setupProtocol: 6 } },
        { name: "realtime-game", metadata: { setupProtocol: "6" } },
        { name: "unrelated", metadata: { setupProtocol: 5 } },
      ]),
    ).toEqual({
      "turn-based": { v5: 1, v6: 1, unknown: 1 },
      realtime: { v5: 1, v6: 1, unknown: 1 },
    });
    expect(countLiveRooms([])).toEqual({
      "turn-based": { v5: 0, v6: 0, unknown: 0 },
      realtime: { v5: 0, v6: 0, unknown: 0 },
    });
  });
});
