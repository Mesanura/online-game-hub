import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { surfaceArtifactManifestV1Schema } from "@online-game-hub/game-surface-bridge";

describe("badminton independent Surface artifact", () => {
  it("locks exact Setup and Play entrypoints without advertising player replay", async () => {
    const manifest = surfaceArtifactManifestV1Schema.parse(
      JSON.parse(
        await readFile(
          new URL("../dist/surface.manifest.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      gameId: "badminton",
      supportedGameVersions: ["1.0.0"],
      surfaceVersion: "1.0.2",
      bridgeVersion: 2,
      entrypoints: { setup: "setup/index.html", play: "play/index.html" },
      capabilities: {},
    });
    expect(manifest.entrypoints.replay).toBeUndefined();
    const lock = JSON.parse(
      await readFile(new URL("../surface.lock.json", import.meta.url), "utf8"),
    );
    expect(lock).toEqual({
      schemaVersion: 1,
      gameId: manifest.gameId,
      surfaceVersion: manifest.surfaceVersion,
      contentDigest: manifest.contentDigest,
    });
  });

  it("owns only Bridge, Phaser and schema dependencies and is independently runnable", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      onlineGameHub: { surfaceArtifact: boolean };
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(manifest.onlineGameHub.surfaceArtifact).toBe(true);
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      "@online-game-hub/game-surface-bridge",
      "phaser",
      "zod",
    ]);
    for (const script of ["dev", "build", "typecheck", "test", "contract-test"])
      expect(manifest.scripts[script]).toEqual(expect.any(String));
  });
});
