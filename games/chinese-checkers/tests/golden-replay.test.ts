import { readFileSync } from "node:fs";
import { eraseGameDefinition } from "@online-game-hub/game-sdk";
import { verifyReplay } from "@online-game-hub/game-server-runtime";
import { describe, expect, it } from "vitest";
import { chineseCheckersDefinition } from "../src/core/index.js";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/chinese-checkers-1.0.0-resignation.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const normalFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/chinese-checkers-1.0.0-normal.json", import.meta.url),
    "utf8",
  ),
);
const multiplayerFixture = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/chinese-checkers-1.0.0-multiplayer-ranking.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

describe("Chinese Checkers golden replay", () => {
  it("rebuilds the assignment-aware resignation ranking", () => {
    const result = verifyReplay(fixture, (gameId, gameVersion) =>
      gameId === chineseCheckersDefinition.manifest.id &&
      gameVersion === chineseCheckersDefinition.manifest.gameVersion
        ? eraseGameDefinition(chineseCheckersDefinition)
        : undefined,
    );
    expect(result).toMatchObject({
      status: "verified",
      rng: { cursor: 0 },
      outcome: fixture.recordedOutcome,
    });
  });

  it("rebuilds a normal assignment-aware move replay", () => {
    expect(
      verifyReplay(normalFixture, (gameId, gameVersion) =>
        gameId === chineseCheckersDefinition.manifest.id &&
        gameVersion === chineseCheckersDefinition.manifest.gameVersion
          ? eraseGameDefinition(chineseCheckersDefinition)
          : undefined,
      ),
    ).toMatchObject({ status: "verified", outcome: null, rng: { cursor: 0 } });
  });

  it("rebuilds a three-player ranking with complete assignment metadata", () => {
    expect(
      verifyReplay(multiplayerFixture, (gameId, gameVersion) =>
        gameId === chineseCheckersDefinition.manifest.id &&
        gameVersion === chineseCheckersDefinition.manifest.gameVersion
          ? eraseGameDefinition(chineseCheckersDefinition)
          : undefined,
      ),
    ).toMatchObject({
      status: "verified",
      outcome: multiplayerFixture.recordedOutcome,
    });
  });
});
