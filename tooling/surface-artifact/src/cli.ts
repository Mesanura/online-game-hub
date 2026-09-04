import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  publishAllSurfaceArtifacts,
  updateSurfaceArtifactLock,
  verifyAllSurfaceArtifacts,
  verifySurfaceWorkspace,
  writeLockedSurfaceManifest,
} from "./artifact.ts";

async function runCli(): Promise<void> {
  const command = process.argv[2];
  const repositoryRoot = path.resolve(process.argv[3] ?? process.cwd());
  if (command === "verify") {
    const artifacts = await verifyAllSurfaceArtifacts(repositoryRoot);
    console.log(`Verified ${artifacts.length} Surface artifact(s).`);
    return;
  }
  if (command === "publish") {
    const outputRoot = path.resolve(
      process.argv[4] ??
        path.join(repositoryRoot, "apps", "web", "public", "game-surfaces"),
    );
    const artifacts = await publishAllSurfaceArtifacts(
      repositoryRoot,
      outputRoot,
    );
    const copied = artifacts.filter((artifact) => artifact.copied).length;
    console.log(
      `Published ${copied} new Surface artifact(s); ${artifacts.length - copied} already matched immutable output.`,
    );
    return;
  }
  if (command === "verify-workspace") {
    const artifact = await verifySurfaceWorkspace(repositoryRoot);
    console.log(
      `Verified Surface ${artifact.manifest.gameId}@${artifact.manifest.surfaceVersion}.`,
    );
    return;
  }
  if (command === "finalize") {
    const artifact = await writeLockedSurfaceManifest(repositoryRoot);
    console.log(
      `Finalized Surface ${artifact.manifest.gameId}@${artifact.manifest.surfaceVersion}.`,
    );
    return;
  }
  if (command === "lock") {
    const artifact = await updateSurfaceArtifactLock(repositoryRoot);
    console.log(
      `Locked Surface ${artifact.manifest.gameId}@${artifact.manifest.surfaceVersion}.`,
    );
    return;
  }
  throw new Error(
    "Usage: cli.ts <verify|publish|verify-workspace|finalize|lock> [root] [outputRoot]",
  );
}

const executedFile = process.argv[1];
if (
  executedFile !== undefined &&
  import.meta.url === pathToFileURL(executedFile).href
) {
  await runCli();
}
