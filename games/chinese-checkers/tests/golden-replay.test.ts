import { readFileSync } from "node:fs";
import { eraseGameDefinition } from "@online-game-hub/game-sdk";
import { verifyReplay } from "@online-game-hub/game-server-runtime";
import { describe, expect, it } from "vitest";
import {
  chineseCheckersDefinition,
  chineseCheckersDefinitionV1_0_0,
} from "../src/core/index.js";

const definitions = [
  eraseGameDefinition(chineseCheckersDefinitionV1_0_0),
  eraseGameDefinition(chineseCheckersDefinition),
];
const resolve = (gameId: string, gameVersion: string) =>
  definitions.find(
    (definition) =>
      definition.manifest.id === gameId &&
      definition.manifest.gameVersion === gameVersion,
  );

describe("Chinese Checkers golden replay", () => {
  for (const version of ["1.0.0", "1.1.0"]) {
    for (const name of ["normal", "resignation", "multiplayer-ranking"]) {
      it(
        "rebuilds " +
          version +
          " " +
          name +
          " with exact geometry and assignments",
        () => {
          const fixture = JSON.parse(
            readFileSync(
              new URL(
                "./fixtures/chinese-checkers-" + version + "-" + name + ".json",
                import.meta.url,
              ),
              "utf8",
            ),
          );
          const result = verifyReplay(fixture, resolve);
          expect(result).toMatchObject({
            status: "verified",
            rng: { cursor: 0 },
            outcome: fixture.recordedOutcome,
          });
          expect(verifyReplay(fixture, resolve)).toEqual(result);
        },
      );
    }
  }

  it("rejects an old move journal relabeled as the new rule version", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/chinese-checkers-1.0.0-normal.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    fixture.header.gameVersion = "1.1.0";
    expect(verifyReplay(fixture, resolve).status).not.toBe("verified");
  });
});
