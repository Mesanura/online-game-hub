import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { chineseCheckersHistory as history } from "../src/history.js";

const outcome = {
  type: "RANKING",
  rankings: [
    { slotId: "a", rank: 1, reason: "FINISHED" },
    { slotId: "b", rank: 2, reason: "LAST_REMAINING" },
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
  it.each(["FINISHED", "RESIGNATION", "BLOCKED", "LAST_REMAINING"])(
    "preserves the recorded rank for %s",
    (reason) => {
      for (const gameVersion of history.gameVersions) {
        expect(
          project(gameVersion, {
            type: "RANKING",
            rankings: [
              { slotId: "b", rank: 1, reason },
              { slotId: "a", rank: 2, reason },
            ],
          }),
        ).toEqual({ kind: "rank", rank: 2, tied: false });
        expect(
          project(gameVersion, {
            ...outcome,
            rankings: [outcome.rankings[0], outcome.rankings[0]],
          }),
        ).toBeNull();
        expect(
          project(gameVersion, {
            type: "RANKING",
            rankings: [
              { slotId: "a", rank: 1, reason },
              { slotId: "b", rank: 1, reason },
            ],
          }),
        ).toBeNull();
      }
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
