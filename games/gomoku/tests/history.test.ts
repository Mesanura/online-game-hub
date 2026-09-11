import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { gomokuHistory as history } from "../src/history.js";

const outcome = {
  type: "WIN",
  winnerSlotId: "a",
  winningCells: [0, 1, 2, 3, 4],
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
      expect(project(gameVersion)).toEqual({ kind: "win-loss", value: "win" });
      expect(JSON.parse(JSON.stringify(project(gameVersion)))).toEqual({
        kind: "win-loss",
        value: "win",
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
    "projects both players and exact resignation support in %s",
    (gameVersion) => {
      expect(project(gameVersion, outcome, "b")).toEqual({
        kind: "win-loss",
        value: "loss",
      });
      const resignation = {
        type: "WIN",
        reason: "RESIGNATION",
        winnerSlotId: "b",
        resignedSlotId: "a",
      };
      expect(project(gameVersion, resignation)).toEqual(
        gameVersion === "1.0.0" ? null : { kind: "win-loss", value: "loss" },
      );
      expect(project(gameVersion, { type: "DRAW" })).toEqual({
        kind: "win-loss",
        value: "draw",
      });
      expect(
        project(gameVersion, { ...outcome, winnerSlotId: "outsider" }),
      ).toBeNull();
      expect(
        project(gameVersion, { ...resignation, winnerSlotId: "a" }),
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
