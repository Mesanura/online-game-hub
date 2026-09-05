import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { surfaceArtifactManifestV1Schema } from "@online-game-hub/game-surface-bridge";

describe("Connect Four Surface artifact contract", () => {
  it("publishes exact Setup, Play, and Replay entrypoints with a locked digest", async () => {
    const manifest = surfaceArtifactManifestV1Schema.parse(
      JSON.parse(
        await readFile(
          new URL("../dist/surface.manifest.json", import.meta.url),
          "utf8",
        ),
      ) as unknown,
    );
    const lock = JSON.parse(
      await readFile(new URL("../surface.lock.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      gameId: "connect-four",
      supportedGameVersions: ["1.0.0", "1.1.0"],
      surfaceVersion: "1.0.1",
      bridgeVersion: 1,
      entrypoints: {
        setup: "setup/index.html",
        play: "play/index.html",
        replay: "replay/index.html",
      },
      capabilities: {},
    });
    expect(lock).toEqual({
      schemaVersion: 1,
      gameId: manifest.gameId,
      surfaceVersion: manifest.surfaceVersion,
      contentDigest: manifest.contentDigest,
    });
  });

  it("depends only on the Bridge and its local schema validator", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      readonly onlineGameHub?: { readonly surfaceArtifact?: boolean };
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly scripts?: Readonly<Record<string, string>>;
    };
    expect(packageJson.onlineGameHub?.surfaceArtifact).toBe(true);
    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual([
      "@online-game-hub/game-surface-bridge",
      "zod",
    ]);
    expect(packageJson.scripts).toMatchObject({
      dev: expect.any(String),
      build: expect.any(String),
      test: expect.any(String),
      "contract-test": expect.any(String),
    });
  });
});
