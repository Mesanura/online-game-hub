import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { surfaceArtifactManifestV1Schema } from "@online-game-hub/game-surface-bridge";

describe("air hockey independent artifact", () => {
  it("locks exact Setup and Play entrypoints with Bridge V2 and no replay", async () => {
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
      gameId: "air-hockey",
      supportedGameVersions: ["1.0.0"],
      surfaceVersion: "1.0.0",
      bridgeVersion: 2,
      entrypoints: { setup: "setup/index.html", play: "play/index.html" },
      capabilities: {},
    });
    expect(manifest.entrypoints.replay).toBeUndefined();
    expect(
      JSON.parse(
        await readFile(
          new URL("../surface.lock.json", import.meta.url),
          "utf8",
        ),
      ),
    ).toEqual({
      schemaVersion: 1,
      gameId: manifest.gameId,
      surfaceVersion: manifest.surfaceVersion,
      contentDigest: manifest.contentDigest,
    });
  });
  it("is independently runnable and owns only its rendering dependencies", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
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
