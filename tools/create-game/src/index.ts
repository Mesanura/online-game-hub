import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { CreateGameError } from "./errors.ts";
import { deriveGameSymbols, validateGameId } from "./naming.ts";
import {
  GENERATED_DIRECTORIES,
  generatedFiles,
  textRegistrations,
} from "./templates.ts";
import type { TextRegistration } from "./templates.ts";

export { CreateGameError } from "./errors.ts";
export type { CreateGameErrorCode } from "./errors.ts";
export { deriveGameSymbols, validateGameId } from "./naming.ts";
export type { GameSymbols } from "./naming.ts";

const WORKSPACE_PACKAGE_PARENTS = [
  "apps",
  "packages",
  "games",
  "tooling",
  "tools",
] as const;

const REGISTRY_PACKAGE_PATH = "packages/game-registry/package.json";
const LOCKFILE_PATH = "pnpm-lock.yaml";

export interface LockfileUpdateContext {
  readonly workspaceRoot: string;
  readonly gameId: string;
  readonly packageManager: string;
}

export type LockfileUpdater = (context: LockfileUpdateContext) => Promise<void>;

export interface CreateGameOptions {
  readonly workspaceRoot: string;
  readonly gameId: string;
  readonly lockfileUpdater?: LockfileUpdater;
}

export interface CreateGameResult {
  readonly status: "created" | "unchanged";
  readonly gameId: string;
  readonly packageName: string;
  readonly gameDirectory: string;
  readonly changedFiles: readonly string[];
}

interface JsonRecord {
  [key: string]: unknown;
}

interface TextFilePlan {
  readonly relativePath: string;
  readonly original: string;
  readonly next: string;
  readonly statuses: readonly boolean[];
}

interface PreflightPlan {
  readonly gameId: string;
  readonly packageName: string;
  readonly packageManager: string;
  readonly workspaceRoot: string;
  readonly gameDirectory: string;
  readonly generated: ReadonlyMap<string, string>;
  readonly textFiles: readonly TextFilePlan[];
  readonly registryPackageOriginal: string;
  readonly registryPackageNext: string;
  readonly registryDependencyPresent: boolean;
  readonly targetPresent: boolean;
  readonly lockfileOriginal: string;
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CreateGameError(
      "WORKSPACE_INVALID",
      `${label} 必须是 JSON object。`,
      2,
    );
  }
  return value as JsonRecord;
}

function parseJson(content: string, label: string): JsonRecord {
  try {
    return asRecord(JSON.parse(content) as unknown, label);
  } catch (error) {
    if (error instanceof CreateGameError) throw error;
    throw new CreateGameError(
      "WORKSPACE_INVALID",
      `${label} 不是有效 JSON。`,
      2,
    );
  }
}

async function readRequiredFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  try {
    return await readFile(path.join(workspaceRoot, relativePath), "utf8");
  } catch {
    throw new CreateGameError(
      "WORKSPACE_INVALID",
      `缺少或无法读取 ${relativePath}。请从 online-game-hub workspace root 运行。`,
      2,
    );
  }
}

function countOccurrences(content: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function detectNewline(content: string): "\n" | "\r\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function withNewline(value: string, newline: "\n" | "\r\n"): string {
  return newline === "\n" ? value : value.replaceAll("\n", "\r\n");
}

function insertBeforeAnchor(
  content: string,
  anchor: string,
  snippet: string,
): string {
  const newline = detectNewline(content);
  const formattedSnippet = withNewline(snippet, newline);
  return content.replace(anchor, `${formattedSnippet}${newline}${anchor}`);
}

function wordPresent(content: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`).test(
    content,
  );
}

function planTextFile(
  relativePath: string,
  original: string,
  registrations: readonly TextRegistration[],
): TextFilePlan {
  const newline = detectNewline(original);
  const statuses: boolean[] = [];
  let residual = original;
  let next = original;

  for (const registration of registrations) {
    if (countOccurrences(original, registration.anchor) !== 1) {
      throw new CreateGameError(
        "CONFLICT",
        `${relativePath} 缺少唯一登记锚点 ${registration.anchor}；未写入任何文件。`,
        2,
      );
    }
    const snippet = withNewline(registration.snippet, newline);
    const count = countOccurrences(original, snippet);
    if (count > 1) {
      throw new CreateGameError(
        "CONFLICT",
        `${relativePath} 中登记片段重复；未写入任何文件。`,
        2,
      );
    }
    const present = count === 1;
    statuses.push(present);
    if (present) residual = residual.replace(snippet, "");
  }

  const collisionTokens = new Set(
    registrations.flatMap(({ collisionTokens }) => collisionTokens),
  );
  for (const token of collisionTokens) {
    if (wordPresent(residual, token)) {
      throw new CreateGameError(
        "CONFLICT",
        `${relativePath} 已含与新登记冲突的 package 或 export symbol ${JSON.stringify(token)}；未写入任何文件。`,
        2,
      );
    }
  }

  for (const [index, registration] of registrations.entries()) {
    if (statuses[index] === false) {
      next = insertBeforeAnchor(
        next,
        registration.anchor,
        registration.snippet,
      );
    }
  }

  return { relativePath, original, next, statuses };
}

async function pathState(
  filePath: string,
): Promise<
  | { readonly kind: "missing" }
  | { readonly kind: "directory"; readonly symbolicLink: boolean }
  | { readonly kind: "file"; readonly symbolicLink: boolean }
> {
  try {
    const state = await lstat(filePath);
    if (state.isDirectory()) {
      return { kind: "directory", symbolicLink: state.isSymbolicLink() };
    }
    return { kind: "file", symbolicLink: state.isSymbolicLink() };
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { kind: "missing" };
    }
    throw error;
  }
}

async function inspectTargetDirectory(
  gameDirectory: string,
  generated: ReadonlyMap<string, string>,
): Promise<boolean> {
  const targetState = await pathState(gameDirectory);
  if (targetState.kind === "missing") return false;
  if (targetState.kind !== "directory" || targetState.symbolicLink) {
    throw new CreateGameError(
      "CONFLICT",
      `${gameDirectory} 已存在但不是可安全复用的普通目录；未写入任何文件。`,
      2,
    );
  }

  for (const relativeDirectory of GENERATED_DIRECTORIES) {
    const state = await pathState(path.join(gameDirectory, relativeDirectory));
    if (state.kind !== "directory" || state.symbolicLink) {
      throw new CreateGameError(
        "CONFLICT",
        `${path.join(gameDirectory, relativeDirectory)} 缺失或类型冲突；已有目录不是完整 create-game 骨架。`,
        2,
      );
    }
  }

  for (const [relativePath, expected] of generated) {
    const targetPath = path.join(gameDirectory, relativePath);
    const state = await pathState(targetPath);
    if (state.kind !== "file" || state.symbolicLink) {
      throw new CreateGameError(
        "CONFLICT",
        `${targetPath} 缺失或类型冲突；已有目录不是完整 create-game 骨架。`,
        2,
      );
    }
    const actual = await readFile(targetPath, "utf8");
    if (actual !== expected) {
      throw new CreateGameError(
        "CONFLICT",
        `${targetPath} 与生成器模板冲突；不会覆盖用户文件。`,
        2,
      );
    }
  }
  return true;
}

async function childDirectories(
  parentPath: string,
): Promise<readonly string[]> {
  try {
    const entries = await readdir(parentPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map(({ name }) => name)
      .sort();
  } catch {
    throw new CreateGameError(
      "WORKSPACE_INVALID",
      `无法枚举 workspace 目录 ${parentPath}。`,
      2,
    );
  }
}

async function assertNoWorkspacePackageConflict(
  workspaceRoot: string,
  packageName: string,
  targetPackagePath: string,
): Promise<void> {
  for (const parent of WORKSPACE_PACKAGE_PARENTS) {
    const parentPath = path.join(workspaceRoot, parent);
    for (const child of await childDirectories(parentPath)) {
      const manifestPath = path.join(parentPath, child, "package.json");
      const state = await pathState(manifestPath);
      if (state.kind === "missing") continue;
      if (state.kind !== "file" || state.symbolicLink) {
        throw new CreateGameError(
          "WORKSPACE_INVALID",
          `${manifestPath} 不是普通 package manifest。`,
          2,
        );
      }
      const manifest = parseJson(
        await readFile(manifestPath, "utf8"),
        path.relative(workspaceRoot, manifestPath),
      );
      if (
        manifest.name === packageName &&
        path.resolve(manifestPath) !== path.resolve(targetPackagePath)
      ) {
        throw new CreateGameError(
          "CONFLICT",
          `workspace package ${packageName} 已由 ${path.relative(workspaceRoot, manifestPath)} 使用。`,
          2,
        );
      }
    }
  }
}

function extractGameId(manifestSource: string): string | undefined {
  return /defineGameId\(\s*["']([^"']+)["']\s*\)/.exec(manifestSource)?.[1];
}

async function assertNoGameOrSymbolConflict(
  workspaceRoot: string,
  gameId: string,
): Promise<void> {
  const requestedSymbols = new Set(
    Object.values(deriveGameSymbols(gameId)).filter(
      (value): value is string => typeof value === "string",
    ),
  );
  const gamesRoot = path.join(workspaceRoot, "games");
  for (const directoryName of await childDirectories(gamesRoot)) {
    if (directoryName === gameId) continue;

    try {
      const otherSymbols = Object.values(deriveGameSymbols(directoryName));
      if (otherSymbols.some((symbol) => requestedSymbols.has(symbol))) {
        throw new CreateGameError(
          "CONFLICT",
          `gameId ${JSON.stringify(gameId)} 推导出的 export symbol 与 games/${directoryName} 碰撞。`,
          2,
        );
      }
    } catch (error) {
      if (error instanceof CreateGameError && error.code === "CONFLICT") {
        throw error;
      }
      if (!(error instanceof CreateGameError)) throw error;
    }

    const manifestPath = path.join(gamesRoot, directoryName, "src/manifest.ts");
    if ((await pathState(manifestPath)).kind === "file") {
      const existingId = extractGameId(await readFile(manifestPath, "utf8"));
      if (existingId === gameId) {
        throw new CreateGameError(
          "CONFLICT",
          `gameId ${JSON.stringify(gameId)} 已由 games/${directoryName} 的 manifest 使用。`,
          2,
        );
      }
    }
  }
}

function sortedRecord(record: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function planRegistryPackage(
  original: string,
  packageName: string,
): { readonly next: string; readonly present: boolean } {
  const manifest = parseJson(original, REGISTRY_PACKAGE_PATH);
  const dependencies = asRecord(
    manifest.dependencies,
    `${REGISTRY_PACKAGE_PATH}#dependencies`,
  );
  const otherDependencySections = [
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ];
  for (const section of otherDependencySections) {
    const value = manifest[section];
    if (
      value !== undefined &&
      Object.hasOwn(
        asRecord(value, `${REGISTRY_PACKAGE_PATH}#${section}`),
        packageName,
      )
    ) {
      throw new CreateGameError(
        "CONFLICT",
        `${REGISTRY_PACKAGE_PATH} 已在错误 dependency section 登记 ${packageName}。`,
        2,
      );
    }
  }

  const current = dependencies[packageName];
  if (current !== undefined && current !== "workspace:*") {
    throw new CreateGameError(
      "CONFLICT",
      `${REGISTRY_PACKAGE_PATH} 中 ${packageName} 的版本不是 workspace:*；不会覆盖。`,
      2,
    );
  }
  const present = current === "workspace:*";
  if (present) return { next: original, present: true };

  const next = {
    ...manifest,
    dependencies: sortedRecord({
      ...dependencies,
      [packageName]: "workspace:*",
    }),
  };
  return { next: `${JSON.stringify(next, null, 2)}\n`, present: false };
}

function packageManagerFromRoot(rootManifest: JsonRecord): string {
  const packageManager = rootManifest.packageManager;
  if (
    typeof packageManager !== "string" ||
    !/^pnpm@\d+\.\d+\.\d+$/.test(packageManager)
  ) {
    throw new CreateGameError(
      "WORKSPACE_INVALID",
      "根 package.json 必须以精确 semver 固定 packageManager: pnpm@x.y.z。",
      2,
    );
  }
  return packageManager;
}

async function preflight(options: CreateGameOptions): Promise<PreflightPlan> {
  validateGameId(options.gameId);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const rootManifestSource = await readRequiredFile(
    workspaceRoot,
    "package.json",
  );
  const rootManifest = parseJson(rootManifestSource, "package.json");
  if (rootManifest.name !== "online-game-hub") {
    throw new CreateGameError(
      "WORKSPACE_INVALID",
      "当前目录不是 online-game-hub workspace root。",
      2,
    );
  }
  const packageManager = packageManagerFromRoot(rootManifest);
  const gamesRoot = path.join(workspaceRoot, "games");
  const gameDirectory = path.resolve(gamesRoot, options.gameId);
  const relativeTarget = path.relative(gamesRoot, gameDirectory);
  if (
    relativeTarget !== options.gameId ||
    relativeTarget.startsWith("..") ||
    path.isAbsolute(relativeTarget)
  ) {
    throw new CreateGameError(
      "INVALID_GAME_ID",
      "gameId 解析结果超出 games 目录。",
      2,
    );
  }

  const packageName = `@online-game-hub/${options.gameId}`;
  const symbols = deriveGameSymbols(options.gameId);
  const generated = generatedFiles(options.gameId);
  const targetPackagePath = path.join(gameDirectory, "package.json");
  await assertNoWorkspacePackageConflict(
    workspaceRoot,
    packageName,
    targetPackagePath,
  );
  await assertNoGameOrSymbolConflict(workspaceRoot, options.gameId);
  const targetPresent = await inspectTargetDirectory(gameDirectory, generated);

  const registrations = textRegistrations(options.gameId, symbols);
  const registrationGroups = new Map<string, TextRegistration[]>();
  for (const registration of registrations) {
    const current = registrationGroups.get(registration.relativePath) ?? [];
    current.push(registration);
    registrationGroups.set(registration.relativePath, current);
  }
  const textFiles: TextFilePlan[] = [];
  for (const [relativePath, fileRegistrations] of registrationGroups) {
    const original = await readRequiredFile(workspaceRoot, relativePath);
    textFiles.push(planTextFile(relativePath, original, fileRegistrations));
  }

  const registryPackageOriginal = await readRequiredFile(
    workspaceRoot,
    REGISTRY_PACKAGE_PATH,
  );
  const registryPackagePlan = planRegistryPackage(
    registryPackageOriginal,
    packageName,
  );
  const lockfileOriginal = await readRequiredFile(workspaceRoot, LOCKFILE_PATH);
  const registrationStatuses = [
    ...textFiles.flatMap(({ statuses }) => statuses),
    registryPackagePlan.present,
  ];
  const everyRegistrationPresent = registrationStatuses.every(Boolean);
  const noRegistrationPresent = registrationStatuses.every(
    (present) => !present,
  );
  if (!(
    (targetPresent && everyRegistrationPresent) ||
    (!targetPresent && noRegistrationPresent)
  )) {
    throw new CreateGameError(
      "CONFLICT",
      `games/${options.gameId} 或其显式登记只完成了一部分；为避免覆盖，未写入任何文件。`,
      2,
    );
  }

  return {
    gameId: options.gameId,
    packageName,
    packageManager,
    workspaceRoot,
    gameDirectory,
    generated,
    textFiles,
    registryPackageOriginal,
    registryPackageNext: registryPackagePlan.next,
    registryDependencyPresent: registryPackagePlan.present,
    targetPresent,
    lockfileOriginal,
  };
}

function defaultLockfileUpdater(packageManager: string): LockfileUpdater {
  const expectedVersion = packageManager.slice("pnpm@".length);
  const npmExecPath = process.env.npm_execpath;
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (
    npmExecPath === undefined ||
    !path.basename(npmExecPath).toLowerCase().includes("pnpm") ||
    !userAgent.startsWith(`pnpm/${expectedVersion} `)
  ) {
    throw new CreateGameError(
      "WORKSPACE_INVALID",
      `必须通过 workspace root 的固定 ${packageManager} 命令运行：pnpm create-game --game-id <id>。`,
      2,
    );
  }

  return async ({ workspaceRoot }) =>
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          npmExecPath,
          "install",
          "--lockfile-only",
          "--offline",
          "--ignore-scripts",
          "--no-frozen-lockfile",
        ],
        {
          cwd: workspaceRoot,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", (error) => {
        reject(error);
      });
      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        const detail = `${stderr}\n${stdout}`.trim().slice(0, 2_000);
        reject(
          new Error(
            `pnpm lockfile-only install 退出码 ${String(code)}${detail.length > 0 ? `：${detail}` : ""}`,
          ),
        );
      });
    });
}

function lockfileHasImporter(lockfile: string, gameId: string): boolean {
  const escaped = gameId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\r?\\n)  ["']?games/${escaped}["']?:\\r?\\n`).test(
    lockfile,
  );
}

async function rollback(
  plan: PreflightPlan,
  removeGeneratedDirectory: boolean,
): Promise<void> {
  for (const textFile of plan.textFiles) {
    await writeFile(
      path.join(plan.workspaceRoot, textFile.relativePath),
      textFile.original,
      "utf8",
    );
  }
  await writeFile(
    path.join(plan.workspaceRoot, REGISTRY_PACKAGE_PATH),
    plan.registryPackageOriginal,
    "utf8",
  );
  await writeFile(
    path.join(plan.workspaceRoot, LOCKFILE_PATH),
    plan.lockfileOriginal,
    "utf8",
  );
  if (removeGeneratedDirectory) {
    const gamesRoot = path.join(plan.workspaceRoot, "games");
    const relativeTarget = path.relative(gamesRoot, plan.gameDirectory);
    if (
      relativeTarget === plan.gameId &&
      !relativeTarget.startsWith("..") &&
      !path.isAbsolute(relativeTarget)
    ) {
      await rm(plan.gameDirectory, { recursive: true, force: true });
    }
  }
}

function changedFileList(plan: PreflightPlan): readonly string[] {
  return Object.freeze(
    [
      ...[...plan.generated.keys()].map(
        (relativePath) => `games/${plan.gameId}/${relativePath}`,
      ),
      ...plan.textFiles.map(({ relativePath }) => relativePath),
      REGISTRY_PACKAGE_PATH,
      LOCKFILE_PATH,
    ].sort(),
  );
}

async function applyPlan(
  plan: PreflightPlan,
  lockfileUpdater: LockfileUpdater,
): Promise<void> {
  let generatedDirectoryCreated = false;
  try {
    await mkdir(plan.gameDirectory);
    generatedDirectoryCreated = true;
    for (const relativeDirectory of GENERATED_DIRECTORIES) {
      await mkdir(path.join(plan.gameDirectory, relativeDirectory), {
        recursive: true,
      });
    }
    for (const [relativePath, content] of plan.generated) {
      await writeFile(path.join(plan.gameDirectory, relativePath), content, {
        encoding: "utf8",
        flag: "wx",
      });
    }
    for (const textFile of plan.textFiles) {
      await writeFile(
        path.join(plan.workspaceRoot, textFile.relativePath),
        textFile.next,
        "utf8",
      );
    }
    await writeFile(
      path.join(plan.workspaceRoot, REGISTRY_PACKAGE_PATH),
      plan.registryPackageNext,
      "utf8",
    );

    try {
      await lockfileUpdater({
        workspaceRoot: plan.workspaceRoot,
        gameId: plan.gameId,
        packageManager: plan.packageManager,
      });
      const lockfile = await readFile(
        path.join(plan.workspaceRoot, LOCKFILE_PATH),
        "utf8",
      );
      if (!lockfileHasImporter(lockfile, plan.gameId)) {
        throw new Error(
          `pnpm 未在 ${LOCKFILE_PATH} 写入 games/${plan.gameId} importer。`,
        );
      }
    } catch (error) {
      throw new CreateGameError(
        "LOCKFILE_UPDATE_FAILED",
        `固定 pnpm 更新 lockfile 失败：${error instanceof Error ? error.message : String(error)}`,
        1,
      );
    }
  } catch (error) {
    try {
      await rollback(plan, generatedDirectoryCreated);
    } catch (rollbackError) {
      throw new CreateGameError(
        "WRITE_FAILED",
        `生成失败且自动回滚未完成。请只检查 games/${plan.gameId}、registry/Next 登记文件与 pnpm-lock.yaml 的本轮 diff，再恢复这些路径。原因：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        1,
      );
    }
    if (error instanceof CreateGameError) throw error;
    throw new CreateGameError(
      "WRITE_FAILED",
      `生成失败，已回滚本轮写入：${error instanceof Error ? error.message : String(error)}`,
      1,
    );
  }
}

export async function createGame(
  options: CreateGameOptions,
): Promise<CreateGameResult> {
  const plan = await preflight(options);
  if (plan.targetPresent && plan.registryDependencyPresent) {
    return Object.freeze({
      status: "unchanged",
      gameId: plan.gameId,
      packageName: plan.packageName,
      gameDirectory: `games/${plan.gameId}`,
      changedFiles: Object.freeze([]),
    });
  }

  const lockfileUpdater =
    options.lockfileUpdater ?? defaultLockfileUpdater(plan.packageManager);
  await applyPlan(plan, lockfileUpdater);
  return Object.freeze({
    status: "created",
    gameId: plan.gameId,
    packageName: plan.packageName,
    gameDirectory: `games/${plan.gameId}`,
    changedFiles: changedFileList(plan),
  });
}
