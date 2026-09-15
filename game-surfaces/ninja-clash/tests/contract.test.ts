import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { surfaceArtifactManifestV1Schema } from "@online-game-hub/game-surface-bridge";
const read = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
it("publishes exact Setup/Play with immutable asset digest", () => {
  const manifest = surfaceArtifactManifestV1Schema.parse(
    read("../dist/surface.manifest.json"),
  );
  expect(manifest).toMatchObject({
    gameId: "ninja-clash",
    supportedGameVersions: ["1.0.0"],
    surfaceVersion: "1.0.2",
    bridgeVersion: 2,
    entrypoints: { setup: "setup/index.html", play: "play/index.html" },
  });
  expect(manifest.entrypoints.replay).toBeUndefined();
  expect(read("../surface.lock.json")).toEqual({
    schemaVersion: 1,
    gameId: "ninja-clash",
    surfaceVersion: "1.0.2",
    contentDigest: manifest.contentDigest,
  });
  expect(Object.keys(read("../package.json").dependencies).sort()).toEqual([
    "@online-game-hub/game-surface-bridge",
    "phaser",
    "zod",
  ]);
});
