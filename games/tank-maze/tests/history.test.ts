import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { tankMazeHistory as history } from "../src/history.js";

const outcome = {
  type: "WIN",
  reason: "SCORE",
  winnerSlotId: "a",
  scores: [
    { slotId: "a", score: 10 },
    { slotId: "b", score: 2 },
  ],
};
function project(
  gameVersion: string,
  recordedOutcome: unknown = outcome,
  playerSlotId = "a",
) {
  return history.projectView({
    gameVersion,
    recordedOutcome,
    players: ["a", "b"],
    playerSlotId,
  });
}

describe("personal history projection", () => {
  it.each(history.gameVersions)(
    "projects safely and without mutation for %s",
    (gameVersion) => {
      const before = JSON.stringify(outcome);
      expect(project(gameVersion)).toEqual({
        kind: "rank",
        rank: 1,
        tied: false,
      });
      expect(JSON.parse(JSON.stringify(project(gameVersion)))).toEqual({
        kind: "rank",
        rank: 1,
        tied: false,
      });
      expect(JSON.stringify(outcome)).toBe(before);
      expect(project(gameVersion, outcome, "outsider")).toBeNull();
      for (const invalid of [
        null,
        {},
        { type: "UNKNOWN" },
        { ...outcome, secret: "hidden" },
      ]) {
        expect(project(gameVersion, invalid)).toBeNull();
      }
      expect(
        history.projectView({
          gameVersion,
          recordedOutcome: outcome,
          players: ["a", "a"],
          playerSlotId: "a",
        }),
      ).toBeNull();
    },
  );
  it("rejects an unknown rule version", () => {
    expect(project("99.0.0")).toBeNull();
  });
  it.each(history.gameVersions)(
    "ranks by score even when the winner trails, with competition ties in %s",
    (gameVersion) => {
      const recordedOutcome = {
        type: "WIN",
        reason: "RESIGNATION",
        winnerSlotId: "d",
        scores: [
          { slotId: "a", score: 9 },
          { slotId: "b", score: 5 },
          { slotId: "c", score: 5 },
          { slotId: "d", score: 1 },
        ],
      };
      for (const [playerSlotId, rank, tied] of [
        ["a", 1, false],
        ["b", 2, true],
        ["c", 2, true],
        ["d", 4, false],
      ] as const) {
        expect(
          history.projectView({
            gameVersion,
            recordedOutcome,
            players: ["d", "c", "b", "a"],
            playerSlotId,
          }),
        ).toEqual({ kind: "rank", rank, tied });
      }
      expect(
        project(gameVersion, {
          type: "DRAW",
          reason: "RESIGNATION",
          winnerSlotId: null,
          scores: [
            { slotId: "a", score: 0 },
            { slotId: "b", score: 0 },
          ],
        }),
      ).toEqual({ kind: "rank", rank: 1, tied: true });
      expect(
        project(gameVersion, {
          ...outcome,
          scores: [outcome.scores[0], outcome.scores[0]],
        }),
      ).toBeNull();
    },
  );
  it("projects the archived results of every existing golden fixture", async () => {
    const directory = new URL("./fixtures/", import.meta.url);
    const files = (await readdir(directory)).filter((file) =>
      file.endsWith(".json"),
    );
    let completed = 0;
    for (const file of files) {
      const replay = JSON.parse(
        await readFile(new URL(file, directory), "utf8"),
      );
      if (replay.recordedOutcome == null) continue;
      const players = replay.header.players.map(
        (player: { slotId: string }) => player.slotId,
      );
      for (const playerSlotId of players) {
        expect(
          history.projectView({
            gameVersion: replay.header.gameVersion,
            recordedOutcome: replay.recordedOutcome,
            players,
            playerSlotId,
          }),
          file,
        ).not.toBeNull();
      }
      completed++;
    }
    expect(completed).toBeGreaterThan(0);
  });
});
