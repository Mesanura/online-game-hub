import { describe, expect, it } from "vitest";
import { airHockeyHistory } from "../src/history.js";

describe("air hockey private history", () => {
  const context = {
    gameVersion: "1.0.0",
    players: ["host", "guest"],
    playerSlotId: "host",
    recordedOutcome: {
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: "guest",
      resignedSlotId: "host",
      scores: [3, 2],
    },
  };
  it.each(["1.0.0", "1.1.0"])(
    "uses actual scores and recorded order for %s, including resignation",
    (gameVersion) => {
      expect(airHockeyHistory.projectView({ ...context, gameVersion })).toEqual(
        {
          kind: "score",
          own: 3,
          opponent: 2,
        },
      );
      expect(
        airHockeyHistory.projectView({
          ...context,
          gameVersion,
          playerSlotId: "guest",
        }),
      ).toEqual({ kind: "score", own: 2, opponent: 3 });
    },
  );
  it("fails closed for unknown versions, identities and invalid outcomes", () => {
    for (const overrides of [
      { gameVersion: "2.0.0" },
      { playerSlotId: "other" },
      { players: ["host", "host"] },
      {
        recordedOutcome: { ...context.recordedOutcome, winnerSlotId: "other" },
      },
      {
        recordedOutcome: {
          ...context.recordedOutcome,
          resignedSlotId: "guest",
        },
      },
    ])
      expect(
        airHockeyHistory.projectView({ ...context, ...overrides }),
      ).toBeNull();
  });
});
