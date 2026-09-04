import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  surfaceArtifactManifestV1Schema,
  type SurfaceArtifactManifestV1,
  type SurfaceMode,
} from "@online-game-hub/game-surface-bridge";

export const SURFACE_MANIFEST_FILENAME = "surface.manifest.json";

export interface VerifiedSurfaceArtifact {
  readonly artifactRoot: string;
  readonly manifest: SurfaceArtifactManifestV1;
  readonly manifestPath: string;
}

export interface PublishedSurfaceArtifact extends VerifiedSurfaceArtifact {
  readonly copied: boolean;
}

interface SurfaceWorkspacePackageJson {
  readonly name?: unknown;
  readonly onlineGameHub?: {
    readonly surfaceArtifact?: unknown;
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function listArtifactFiles(
  artifactRoot: string,
  currentDirectory = artifactRoot,
): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = path.join(currentDirectory, entry.name);
    const metadata = await lstat(entryPath);
    if (metadata.isSymbolicLink()) {
      throw new Error(
        `Surface artifacts must not contain symbolic links: ${entryPath}`,
      );
    }
    if (metadata.isDirectory()) {
      files.push(...(await listArtifactFiles(artifactRoot, entryPath)));
    } else if (metadata.isFile()) {
      const relativePath = toPosix(path.relative(artifactRoot, entryPath));
      if (relativePath !== SURFACE_MANIFEST_FILENAME) files.push(relativePath);
    } else {
      throw new Error(`Unsupported Surface artifact entry: ${entryPath}`);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export async function computeSurfaceContentDigest(
  artifactRoot: string,
): Promise<string> {
  const hash = createHash("sha256");
  hash.update("online-game-hub-surface-artifact-v1\0", "utf8");
  for (const relativePath of await listArtifactFiles(artifactRoot)) {
    const contents = await readFile(path.join(artifactRoot, relativePath));
    hash.update(`${Buffer.byteLength(relativePath)}:${relativePath}\0`, "utf8");
    hash.update(`${contents.byteLength}:`, "utf8");
    hash.update(contents);
    hash.update("\0", "utf8");
  }
  return `sha256-${hash.digest("base64")}`;
}

export async function writeSurfaceManifest(
  artifactRoot: string,
  manifest: SurfaceArtifactManifestV1,
): Promise<void> {
  const parsed = surfaceArtifactManifestV1Schema.parse(manifest);
  await writeFile(
    path.join(artifactRoot, SURFACE_MANIFEST_FILENAME),
    `${JSON.stringify(parsed, null, 2)}\n`,
    "utf8",
  );
}

export async function verifySurfaceArtifactDirectory(
  artifactRoot: string,
  expectedGameId?: string,
): Promise<VerifiedSurfaceArtifact> {
  const resolvedRoot = path.resolve(artifactRoot);
  const manifestPath = path.join(resolvedRoot, SURFACE_MANIFEST_FILENAME);
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Cannot read Surface manifest ${manifestPath}.`, {
      cause: error,
    });
  }
  const manifest = surfaceArtifactManifestV1Schema.parse(manifestJson);
  if (expectedGameId !== undefined && manifest.gameId !== expectedGameId) {
    throw new Error(
      `Surface manifest gameId ${manifest.gameId} does not match workspace ${expectedGameId}.`,
    );
  }

  const entrypoints = Object.entries(manifest.entrypoints) as Array<
    [SurfaceMode, string | undefined]
  >;
  for (const [mode, entrypoint] of entrypoints) {
    if (entrypoint === undefined) continue;
    if (!entrypoint.startsWith(`${mode}/`)) {
      throw new Error(
        `Surface ${mode} entrypoint must be inside the ${mode}/ directory.`,
      );
    }
    const absoluteEntrypoint = path.resolve(resolvedRoot, entrypoint);
    if (!isInside(resolvedRoot, absoluteEntrypoint)) {
      throw new Error(`Surface ${mode} entrypoint escapes its artifact root.`);
    }
    const metadata = await lstat(absoluteEntrypoint).catch(() => null);
    if (metadata === null || !metadata.isFile()) {
      throw new Error(
        `Surface ${mode} entrypoint does not exist: ${entrypoint}`,
      );
    }
  }

  const actualDigest = await computeSurfaceContentDigest(resolvedRoot);
  if (actualDigest !== manifest.contentDigest) {
    throw new Error(
      `Surface content digest mismatch: expected ${manifest.contentDigest}, received ${actualDigest}.`,
    );
  }
  return { artifactRoot: resolvedRoot, manifest, manifestPath };
}

export async function verifySurfaceWorkspace(
  workspaceRoot: string,
): Promise<VerifiedSurfaceArtifact> {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const packageJson = JSON.parse(
    await readFile(path.join(resolvedWorkspace, "package.json"), "utf8"),
  ) as SurfaceWorkspacePackageJson;
  if (packageJson.onlineGameHub?.surfaceArtifact !== true) {
    throw new Error(
      `${resolvedWorkspace} must declare onlineGameHub.surfaceArtifact: true.`,
    );
  }
  return verifySurfaceArtifactDirectory(
    path.join(resolvedWorkspace, "dist"),
    path.basename(resolvedWorkspace),
  );
}

export async function verifyAllSurfaceArtifacts(
  repositoryRoot: string,
): Promise<VerifiedSurfaceArtifact[]> {
  const surfaceRoot = path.join(path.resolve(repositoryRoot), "game-surfaces");
  if (!(await pathExists(surfaceRoot))) return [];
  const artifacts: VerifiedSurfaceArtifact[] = [];
  for (const entry of (
    await readdir(surfaceRoot, { withFileTypes: true })
  ).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const workspaceRoot = path.join(surfaceRoot, entry.name);
    const packageJsonPath = path.join(workspaceRoot, "package.json");
    if (!(await pathExists(packageJsonPath))) continue;
    const packageJson = JSON.parse(
      await readFile(packageJsonPath, "utf8"),
    ) as SurfaceWorkspacePackageJson;
    const marker = packageJson.onlineGameHub?.surfaceArtifact;
    if (marker === false) continue;
    if (marker !== true) {
      throw new Error(
        `${packageJsonPath} must explicitly declare onlineGameHub.surfaceArtifact as true or false.`,
      );
    }
    artifacts.push(await verifySurfaceWorkspace(workspaceRoot));
  }
  return artifacts;
}

async function copyArtifactDirectory(
  sourceRoot: string,
  destinationRoot: string,
): Promise<void> {
  await mkdir(destinationRoot, { recursive: true });
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const destinationPath = path.join(destinationRoot, entry.name);
    const metadata = await lstat(sourcePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(
        `Surface artifacts must not contain symbolic links: ${sourcePath}`,
      );
    }
    if (metadata.isDirectory()) {
      await copyArtifactDirectory(sourcePath, destinationPath);
    } else if (metadata.isFile()) {
      await copyFile(sourcePath, destinationPath);
    } else {
      throw new Error(`Unsupported Surface artifact entry: ${sourcePath}`);
    }
  }
}

export async function publishSurfaceArtifact(
  artifact: VerifiedSurfaceArtifact,
  outputRoot: string,
): Promise<PublishedSurfaceArtifact> {
  const resolvedOutput = path.resolve(outputRoot);
  const gameRoot = path.join(resolvedOutput, artifact.manifest.gameId);
  const destinationRoot = path.join(gameRoot, artifact.manifest.surfaceVersion);
  if (
    !isInside(resolvedOutput, gameRoot) ||
    !isInside(gameRoot, destinationRoot)
  ) {
    throw new Error("Surface publish destination escapes the output root.");
  }
  if (await pathExists(destinationRoot)) {
    const existing = await verifySurfaceArtifactDirectory(
      destinationRoot,
      artifact.manifest.gameId,
    );
    if (
      existing.manifest.surfaceVersion === artifact.manifest.surfaceVersion &&
      existing.manifest.contentDigest === artifact.manifest.contentDigest
    ) {
      return { ...existing, copied: false };
    }
    throw new Error(
      `Refusing to overwrite immutable Surface ${artifact.manifest.gameId}@${artifact.manifest.surfaceVersion}.`,
    );
  }

  await mkdir(gameRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(
    path.join(gameRoot, `.${artifact.manifest.surfaceVersion}-`),
  );
  try {
    await copyArtifactDirectory(artifact.artifactRoot, temporaryRoot);
    await verifySurfaceArtifactDirectory(
      temporaryRoot,
      artifact.manifest.gameId,
    );
    await rename(temporaryRoot, destinationRoot);
  } catch (error) {
    if (isInside(gameRoot, temporaryRoot)) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
    throw error;
  }
  return {
    artifactRoot: destinationRoot,
    manifest: artifact.manifest,
    manifestPath: path.join(destinationRoot, SURFACE_MANIFEST_FILENAME),
    copied: true,
  };
}

export async function publishAllSurfaceArtifacts(
  repositoryRoot: string,
  outputRoot: string,
): Promise<PublishedSurfaceArtifact[]> {
  const verified = await verifyAllSurfaceArtifacts(repositoryRoot);
  const published: PublishedSurfaceArtifact[] = [];
  for (const artifact of verified) {
    published.push(await publishSurfaceArtifact(artifact, outputRoot));
  }
  return published;
}
