import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeSurfaceContentDigest,
  publishSurfaceArtifact,
  verifyAllSurfaceArtifacts,
  verifySurfaceWorkspace,
  writeSurfaceManifest,
} from "../src/artifact.ts";

async function createSurfaceWorkspace(root: string): Promise<string> {
  const workspaceRoot = path.join(root, "game-surfaces", "test-game");
  const distRoot = path.join(workspaceRoot, "dist");
  await mkdir(path.join(distRoot, "setup"), { recursive: true });
  await mkdir(path.join(distRoot, "play"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "package.json"),
    JSON.stringify({
      name: "@fixture/test-game-surface",
      private: true,
      onlineGameHub: { surfaceArtifact: true },
    }),
  );
  await writeFile(path.join(distRoot, "setup", "index.html"), "setup");
  await writeFile(path.join(distRoot, "play", "index.html"), "play");
  const digest = await computeSurfaceContentDigest(distRoot);
  await writeSurfaceManifest(distRoot, {
    schemaVersion: 1,
    gameId: "test-game",
    supportedGameVersions: ["1.0.0"],
    surfaceVersion: "1.0.0",
    bridgeVersion: 1,
    entrypoints: {
      setup: "setup/index.html",
      play: "play/index.html",
    },
    capabilities: {},
    contentDigest: digest,
  });
  return workspaceRoot;
}

test("verifies canonical content and exact mode entrypoints", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ogh-surface-artifact-"));
  try {
    const workspace = await createSurfaceWorkspace(root);
    const verified = await verifySurfaceWorkspace(workspace);
    assert.equal(verified.manifest.gameId, "test-game");
    assert.deepEqual(await verifyAllSurfaceArtifacts(root), [verified]);

    await writeFile(
      path.join(workspace, "dist", "play", "index.html"),
      "drift",
    );
    await assert.rejects(
      verifySurfaceWorkspace(workspace),
      /content digest mismatch/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a missing or cross-mode entrypoint", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ogh-surface-artifact-"));
  try {
    const workspace = await createSurfaceWorkspace(root);
    const manifestPath = path.join(workspace, "dist", "surface.manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.entrypoints = {
      setup: "play/index.html",
      play: "play/missing.html",
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifySurfaceWorkspace(workspace),
      /setup entrypoint must be inside the setup\/ directory/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publishes immutably and treats an identical retry as a no-op", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ogh-surface-artifact-"));
  try {
    const workspace = await createSurfaceWorkspace(root);
    const artifact = await verifySurfaceWorkspace(workspace);
    const outputRoot = path.join(root, "published");
    const first = await publishSurfaceArtifact(artifact, outputRoot);
    const second = await publishSurfaceArtifact(artifact, outputRoot);
    assert.equal(first.copied, true);
    assert.equal(second.copied, false);

    await writeFile(
      path.join(first.artifactRoot, "play", "index.html"),
      "corrupt",
    );
    await assert.rejects(
      publishSurfaceArtifact(artifact, outputRoot),
      /content digest mismatch/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
