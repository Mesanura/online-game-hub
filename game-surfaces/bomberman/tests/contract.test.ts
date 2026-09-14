import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { surfaceArtifactManifestV1Schema } from "@online-game-hub/game-surface-bridge";
const read = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
it("publishes exact independent Setup/Play artifacts with a matching immutable digest", () => {
  const manifest = surfaceArtifactManifestV1Schema.parse(
    read("../dist/surface.manifest.json"),
  );
  expect(manifest).toMatchObject({
    schemaVersion: 1,
    gameId: "bomberman",
    supportedGameVersions: ["1.0.0"],
    surfaceVersion: "1.0.1",
    bridgeVersion: 2,
    entrypoints: { setup: "setup/index.html", play: "play/index.html" },
    capabilities: {},
  });
  expect(manifest.entrypoints.replay).toBeUndefined();
  expect(read("../surface.lock.json")).toEqual({
    schemaVersion: 1,
    gameId: manifest.gameId,
    surfaceVersion: manifest.surfaceVersion,
    contentDigest: manifest.contentDigest,
  });
  const pkg = read("../package.json");
  expect(pkg.onlineGameHub.surfaceArtifact).toBe(true);
  expect(Object.keys(pkg.dependencies).sort()).toEqual([
    "@online-game-hub/game-surface-bridge",
    "phaser",
    "zod",
  ]);
  for (const script of ["dev", "build", "typecheck", "test", "contract-test"])
    expect(pkg.scripts[script]).toEqual(expect.any(String));
});
