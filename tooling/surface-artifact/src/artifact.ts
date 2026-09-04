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
export const SURFACE_CONFIG_FILENAME = "surface.config.json";
export const SURFACE_LOCK_FILENAME = "surface.lock.json";

const surfaceArtifactConfigV1Schema = surfaceArtifactManifestV1Schema.omit({
  contentDigest: true,
});
export type SurfaceArtifactConfigV1 = Omit<
  SurfaceArtifactManifestV1,
  "contentDigest"
>;
const surfaceArtifactLockV1Schema = surfaceArtifactManifestV1Schema.pick({
  schemaVersion: true,
  gameId: true,
  surfaceVersion: true,
  contentDigest: true,
});
export type SurfaceArtifactLockV1 = Pick<
  SurfaceArtifactManifestV1,
  "schemaVersion" | "gameId" | "surfaceVersion" | "contentDigest"
>;

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

export async function readSurfaceArtifactConfig(
  workspaceRoot: string,
): Promise<SurfaceArtifactConfigV1> {
  const configPath = path.join(
    path.resolve(workspaceRoot),
    SURFACE_CONFIG_FILENAME,
  );
  let configJson: unknown;
  try {
    configJson = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Cannot read Surface artifact config ${configPath}.`, {
      cause: error,
    });
  }
  return surfaceArtifactConfigV1Schema.parse(configJson);
}

export async function readSurfaceArtifactLock(
  workspaceRoot: string,
): Promise<SurfaceArtifactLockV1> {
  const lockPath = path.join(
    path.resolve(workspaceRoot),
    SURFACE_LOCK_FILENAME,
  );
  let lockJson: unknown;
  try {
    lockJson = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Cannot read Surface artifact lock ${lockPath}.`, {
      cause: error,
    });
  }
  return surfaceArtifactLockV1Schema.parse(lockJson);
}

export async function writeSurfaceArtifactLock(
  workspaceRoot: string,
  lock: SurfaceArtifactLockV1,
): Promise<void> {
  const parsed = surfaceArtifactLockV1Schema.parse(lock);
  await writeFile(
    path.join(path.resolve(workspaceRoot), SURFACE_LOCK_FILENAME),
    `${JSON.stringify(parsed, null, 2)}\n`,
    "utf8",
  );
}

interface ComparableSemver {
  readonly core: readonly [bigint, bigint, bigint];
  readonly prerelease: readonly string[] | null;
}

function comparableSemver(version: string): ComparableSemver {
  const withoutBuild = version.split("+", 1)[0] ?? version;
  const prereleaseSeparator = withoutBuild.indexOf("-");
  const coreText =
    prereleaseSeparator === -1
      ? withoutBuild
      : withoutBuild.slice(0, prereleaseSeparator);
  const coreParts = coreText.split(".").map((part) => BigInt(part));
  const major = coreParts[0];
  const minor = coreParts[1];
  const patch = coreParts[2];
  if (major === undefined || minor === undefined || patch === undefined) {
    throw new TypeError(`Invalid Surface version ${version}.`);
  }
  return {
    core: [major, minor, patch],
    prerelease:
      prereleaseSeparator === -1
        ? null
        : withoutBuild.slice(prereleaseSeparator + 1).split("."),
  };
}

function compareSemver(leftVersion: string, rightVersion: string): number {
  const left = comparableSemver(leftVersion);
  const right = comparableSemver(rightVersion);
  for (const index of [0, 1, 2] as const) {
    const leftPart = left.core[index];
    const rightPart = right.core[index];
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  if (left.prerelease === null || right.prerelease === null) {
    if (left.prerelease === right.prerelease) return 0;
    return left.prerelease === null ? 1 : -1;
  }
  const identifiers = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < identifiers; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/u.test(leftIdentifier);
    const rightNumeric = /^\d+$/u.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return BigInt(leftIdentifier) < BigInt(rightIdentifier) ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

export function assertSurfaceArtifactLockUpdate(
  currentLock: SurfaceArtifactLockV1,
  nextLock: SurfaceArtifactLockV1,
): void {
  const current = surfaceArtifactLockV1Schema.parse(currentLock);
  const next = surfaceArtifactLockV1Schema.parse(nextLock);
  if (current.gameId !== next.gameId) {
    throw new Error("A Surface artifact lock cannot change gameId.");
  }
  if (
    current.surfaceVersion !== next.surfaceVersion &&
    compareSemver(next.surfaceVersion, current.surfaceVersion) <= 0
  ) {
    throw new Error("A Surface artifact lock must increment surfaceVersion.");
  }
  if (
    current.surfaceVersion === next.surfaceVersion &&
    current.contentDigest !== next.contentDigest
  ) {
    throw new Error(
      "Surface content changed without a surfaceVersion increment.",
    );
  }
}

export async function writeLockedSurfaceManifest(
  workspaceRoot: string,
): Promise<VerifiedSurfaceArtifact> {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const config = await readSurfaceArtifactConfig(resolvedWorkspace);
  const lock = await readSurfaceArtifactLock(resolvedWorkspace);
  if (
    lock.gameId !== config.gameId ||
    lock.surfaceVersion !== config.surfaceVersion
  ) {
    throw new Error(
      "Surface config and artifact lock identify different builds.",
    );
  }
  await writeSurfaceManifest(path.join(resolvedWorkspace, "dist"), {
    ...config,
    contentDigest: lock.contentDigest,
  });
  return verifySurfaceWorkspace(resolvedWorkspace);
}

export async function updateSurfaceArtifactLock(
  workspaceRoot: string,
): Promise<VerifiedSurfaceArtifact> {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const artifactRoot = path.join(resolvedWorkspace, "dist");
  const config = await readSurfaceArtifactConfig(resolvedWorkspace);
  const nextLock = {
    schemaVersion: config.schemaVersion,
    gameId: config.gameId,
    surfaceVersion: config.surfaceVersion,
    contentDigest: await computeSurfaceContentDigest(artifactRoot),
  } satisfies SurfaceArtifactLockV1;
  if (await pathExists(path.join(resolvedWorkspace, SURFACE_LOCK_FILENAME))) {
    assertSurfaceArtifactLockUpdate(
      await readSurfaceArtifactLock(resolvedWorkspace),
      nextLock,
    );
  }
  await writeSurfaceArtifactLock(resolvedWorkspace, nextLock);
  await writeSurfaceManifest(artifactRoot, { ...config, ...nextLock });
  return verifySurfaceWorkspace(resolvedWorkspace);
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
  const artifact = await verifySurfaceArtifactDirectory(
    path.join(resolvedWorkspace, "dist"),
    path.basename(resolvedWorkspace),
  );
  const lock = await readSurfaceArtifactLock(resolvedWorkspace);
  if (
    lock.gameId !== artifact.manifest.gameId ||
    lock.surfaceVersion !== artifact.manifest.surfaceVersion ||
    lock.contentDigest !== artifact.manifest.contentDigest
  ) {
    throw new Error(
      `Surface artifact lock does not match ${artifact.manifest.gameId}@${artifact.manifest.surfaceVersion}.`,
    );
  }
  return artifact;
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
