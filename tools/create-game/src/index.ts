import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { CreateGameError } from "./errors.ts";
import { deriveGameSymbols, validateGameId } from "./naming.ts";
import { generatedPackages } from "./templates.ts";
import type { GeneratedPackage } from "./templates.ts";

export { CreateGameError } from "./errors.ts";
export type { CreateGameErrorCode } from "./errors.ts";
export { deriveGameSymbols, validateGameId } from "./naming.ts";
export type { GameSymbols } from "./naming.ts";

const WORKSPACE_PACKAGE_PARENTS = [
  "apps",
  "packages",
  "games",
  "game-surfaces",
  "tooling",
  "tools",
] as const;
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
  readonly surfacePackageName: string;
  readonly surfaceDirectory: string;
  readonly changedFiles: readonly string[];
}
interface TargetPlan extends GeneratedPackage {
  readonly absoluteDirectory: string;
  readonly present: boolean;
}
interface PreflightPlan {
  readonly gameId: string;
  readonly packageManager: string;
  readonly workspaceRoot: string;
  readonly targets: readonly TargetPlan[];
  readonly lockfileOriginal: string;
  readonly unchanged: boolean;
}
type JsonRecord = Record<string, unknown>;

function parseJson(content: string, label: string): JsonRecord {
  try {
    const value: unknown = JSON.parse(content);
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error("Expected an object.");
    return value as JsonRecord;
  } catch {
    throw new CreateGameError(
      "WORKSPACE_INVALID",
      `${label} 不是有效 JSON object。`,
      2,
    );
  }
}
async function pathState(filePath: string) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}
async function readPlainFile(filePath: string): Promise<string> {
  const state = await pathState(filePath);
  if (state === null || !state.isFile() || state.isSymbolicLink()) {
    throw new CreateGameError(
      "CONFLICT",
      `${filePath} 缺失或不是普通文件；未写入任何文件。`,
      2,
    );
  }
  return readFile(filePath, "utf8");
}
async function assertPlainDirectory(directory: string): Promise<void> {
  const state = await pathState(directory);
  if (state === null || !state.isDirectory() || state.isSymbolicLink()) {
    throw new CreateGameError(
      "CONFLICT",
      `${directory} 缺失或不是普通目录；未写入任何文件。`,
      2,
    );
  }
}
function parentDirectories(
  files: ReadonlyMap<string, string>,
): readonly string[] {
  const directories = new Set<string>();
  for (const file of files.keys()) {
    let directory = path.posix.dirname(file);
    while (directory !== ".") {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  return [...directories].sort();
}
async function inspectTargetDirectory(
  target: GeneratedPackage,
  absoluteDirectory: string,
): Promise<boolean> {
  if ((await pathState(absoluteDirectory)) === null) return false;
  await assertPlainDirectory(absoluteDirectory);
  for (const directory of parentDirectories(target.files)) {
    await assertPlainDirectory(path.join(absoluteDirectory, directory));
  }
  for (const [relativePath, expected] of target.files) {
    const filePath = path.join(absoluteDirectory, relativePath);
    if ((await readPlainFile(filePath)) !== expected) {
      throw new CreateGameError(
        "CONFLICT",
        `${filePath} 与草稿模板冲突；不会覆盖用户文件。`,
        2,
      );
    }
  }
  return true;
}
async function childDirectories(
  parentPath: string,
): Promise<readonly string[]> {
  await assertPlainDirectory(parentPath);
  const entries = await readdir(parentPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map(({ name }) => name)
    .sort();
}
async function assertNoPackageConflict(
  workspaceRoot: string,
  targets: readonly GeneratedPackage[],
): Promise<void> {
  for (const parent of WORKSPACE_PACKAGE_PARENTS) {
    for (const child of await childDirectories(
      path.join(workspaceRoot, parent),
    )) {
      const relativeDirectory = `${parent}/${child}`;
      const manifestPath = path.join(
        workspaceRoot,
        relativeDirectory,
        "package.json",
      );
      if ((await pathState(manifestPath)) === null) continue;
      const manifest = parseJson(
        await readPlainFile(manifestPath),
        manifestPath,
      );
      for (const target of targets) {
        if (
          manifest.name === target.packageName &&
          relativeDirectory !== target.relativeDirectory
        ) {
          throw new CreateGameError(
            "CONFLICT",
            `workspace package ${target.packageName} 已由 ${relativeDirectory} 使用。`,
            2,
          );
        }
      }
    }
  }
}
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^\u0024{}()|[\]\\]/g, "\\$&");
}
function wordPresent(content: string, token: string): boolean {
  return new RegExp(
    `(^|[^A-Za-z0-9_$])${escapeRegExp(token)}([^A-Za-z0-9_$]|$)`,
  ).test(content);
}
async function assertNoGameOrSymbolConflict(
  workspaceRoot: string,
  gameId: string,
): Promise<void> {
  const symbols = Object.values(deriveGameSymbols(gameId));
  for (const otherId of await childDirectories(
    path.join(workspaceRoot, "games"),
  )) {
    if (otherId === gameId) continue;
    try {
      if (
        Object.values(deriveGameSymbols(otherId)).some((symbol) =>
          symbols.includes(symbol),
        )
      ) {
        throw new CreateGameError(
          "CONFLICT",
          `gameId ${gameId} 推导出的 export symbol 与 games/${otherId} 碰撞。`,
          2,
        );
      }
    } catch (error) {
      if (
        !(error instanceof CreateGameError) ||
        error.code !== "INVALID_GAME_ID"
      )
        throw error;
    }
    const manifestPath = path.join(
      workspaceRoot,
      "games",
      otherId,
      "src/manifest.ts",
    );
    if ((await pathState(manifestPath)) === null) continue;
    const source = await readPlainFile(manifestPath);
    if (/defineGameId\(\s*["']([^"']+)["']\s*\)/.exec(source)?.[1] === gameId) {
      throw new CreateGameError(
        "CONFLICT",
        `gameId ${gameId} 已由 games/${otherId} 的 manifest 使用。`,
        2,
      );
    }
  }
  // Existing explicit registrations are conflicts, never files to repair or rewrite.
  const packageNames = [
    `@online-game-hub/${gameId}`,
    `@online-game-hub/${gameId}-surface`,
  ];
  for (const relativePath of [
    "packages/game-registry/package.json",
    "packages/game-registry/src/catalog.ts",
    "packages/game-registry/src/server.ts",
    "packages/game-registry/src/deployment.ts",
  ]) {
    const filePath = path.join(workspaceRoot, relativePath);
    if ((await pathState(filePath)) === null) continue;
    const source = await readPlainFile(filePath);
    if (
      symbols.some((symbol) => wordPresent(source, symbol)) ||
      packageNames.some((name) =>
        new RegExp(`["']${escapeRegExp(name)}(?:["']|/)`).test(source),
      )
    ) {
      throw new CreateGameError(
        "CONFLICT",
        `${relativePath} 已含该游戏的登记或命名；不会覆盖已有接入。`,
        2,
      );
    }
  }
}
function lockfileHasImporter(
  lockfile: string,
  relativeDirectory: string,
): boolean {
  return new RegExp(
    `^  ["']?${escapeRegExp(relativeDirectory)}["']?:`,
    "m",
  ).test(lockfile);
}
async function preflight(options: CreateGameOptions): Promise<PreflightPlan> {
  validateGameId(options.gameId);
  const workspaceRoot = await realpath(path.resolve(options.workspaceRoot));
  const rootManifestPath = path.join(workspaceRoot, "package.json");
  const rootManifest = parseJson(
    await readPlainFile(rootManifestPath),
    rootManifestPath,
  );
  const packageManager = rootManifest.packageManager;
  if (
    rootManifest.name !== "online-game-hub" ||
    typeof packageManager !== "string" ||
    !/^pnpm@\d+\.\d+\.\d+$/.test(packageManager)
  ) {
    throw new CreateGameError(
      "WORKSPACE_INVALID",
      "请从固定 pnpm@x.y.z 的 online-game-hub workspace root 运行。",
      2,
    );
  }
  const generated = generatedPackages(options.gameId);
  await assertNoPackageConflict(workspaceRoot, generated);
  await assertNoGameOrSymbolConflict(workspaceRoot, options.gameId);
  const formatting = await resolveConfig(rootManifestPath);
  const targets: TargetPlan[] = [];
  for (const target of generated) {
    const absoluteDirectory = path.resolve(
      workspaceRoot,
      target.relativeDirectory,
    );
    await assertPlainDirectory(path.dirname(absoluteDirectory));
    const files = new Map<string, string>();
    for (const [relativePath, content] of target.files) {
      files.set(
        relativePath,
        await format(content, {
          ...formatting,
          filepath: path.join(absoluteDirectory, relativePath),
        }),
      );
    }
    const formatted = { ...target, files };
    targets.push({
      ...formatted,
      absoluteDirectory,
      present: await inspectTargetDirectory(formatted, absoluteDirectory),
    });
  }
  const lockfileOriginal = await readPlainFile(
    path.join(workspaceRoot, LOCKFILE_PATH),
  );
  const statuses = targets.flatMap((target) => [
    target.present,
    lockfileHasImporter(lockfileOriginal, target.relativeDirectory),
  ]);
  if (!statuses.every(Boolean) && !statuses.every((present) => !present)) {
    throw new CreateGameError(
      "CONFLICT",
      "游戏目录、Surface 目录或 lockfile importer 只完成了一部分；未写入任何文件。",
      2,
    );
  }
  return {
    gameId: options.gameId,
    packageManager,
    workspaceRoot,
    targets,
    lockfileOriginal,
    unchanged: statuses.every(Boolean),
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
      `必须通过 workspace root 的固定 ${packageManager} 运行：pnpm create-game --game-id <id>。`,
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
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        const detail = `${stderr}\n${stdout}`.trim().slice(0, 2_000);
        reject(
          new Error(
            `pnpm lockfile-only install 退出码 ${String(code)}：${detail}`,
          ),
        );
      });
    });
}
async function currentLockfile(filePath: string): Promise<string | null> {
  return (await pathState(filePath)) === null ? null : readPlainFile(filePath);
}
async function removeCreatedTarget(
  plan: PreflightPlan,
  target: TargetPlan,
): Promise<void> {
  const expected = path.join(plan.workspaceRoot, target.relativeDirectory);
  const state = await pathState(target.absoluteDirectory);
  if (state === null) return;
  if (
    !state.isDirectory() ||
    state.isSymbolicLink() ||
    (await realpath(target.absoluteDirectory)) !== expected
  ) {
    throw new Error(`${target.relativeDirectory} 路径已改变，无法安全回滚。`);
  }
  await rm(expected, { recursive: true, force: true });
}
async function applyPlan(
  plan: PreflightPlan,
  lockfileUpdater: LockfileUpdater,
): Promise<void> {
  const created: TargetPlan[] = [];
  const lockfilePath = path.join(plan.workspaceRoot, LOCKFILE_PATH);
  let lockfileUpdateStarted = false;
  let observedLockfile: string | null = plan.lockfileOriginal;
  try {
    for (const target of plan.targets) {
      await assertPlainDirectory(path.dirname(target.absoluteDirectory));
      await mkdir(target.absoluteDirectory);
      created.push(target);
      for (const directory of parentDirectories(target.files))
        await mkdir(path.join(target.absoluteDirectory, directory), {
          recursive: true,
        });
      for (const [relativePath, content] of target.files) {
        await writeFile(
          path.join(target.absoluteDirectory, relativePath),
          content,
          { encoding: "utf8", flag: "wx" },
        );
      }
    }
    if ((await readPlainFile(lockfilePath)) !== plan.lockfileOriginal)
      throw new Error("pnpm-lock.yaml 在预检后发生变化，未覆盖该文件。");
    try {
      lockfileUpdateStarted = true;
      try {
        await lockfileUpdater({
          workspaceRoot: plan.workspaceRoot,
          gameId: plan.gameId,
          packageManager: plan.packageManager,
        });
      } finally {
        observedLockfile = await currentLockfile(lockfilePath);
      }
      if (
        observedLockfile === null ||
        !plan.targets.every((target) =>
          lockfileHasImporter(observedLockfile ?? "", target.relativeDirectory),
        )
      ) {
        throw new Error("pnpm 未写入游戏和 Surface 的两个 importer。");
      }
    } catch (error) {
      throw new CreateGameError(
        "LOCKFILE_UPDATE_FAILED",
        `固定 pnpm 更新 lockfile 失败：${error instanceof Error ? error.message : String(error)}`,
        1,
      );
    }
  } catch (error) {
    const failures: string[] = [];
    if (lockfileUpdateStarted) {
      try {
        if ((await currentLockfile(lockfilePath)) !== observedLockfile)
          throw new Error("lockfile 已被其他写入改变。", { cause: error });
        await writeFile(lockfilePath, plan.lockfileOriginal, "utf8");
      } catch (rollbackError) {
        failures.push(String(rollbackError));
      }
    }
    for (const target of [...created].reverse()) {
      try {
        await removeCreatedTarget(plan, target);
      } catch (rollbackError) {
        failures.push(String(rollbackError));
      }
    }
    if (failures.length > 0) {
      throw new CreateGameError(
        "WRITE_FAILED",
        `生成失败且回滚未完成；只检查 games/${plan.gameId}、game-surfaces/${plan.gameId} 与 pnpm-lock.yaml。${failures.join(" ")}`,
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
  if (!plan.unchanged)
    await applyPlan(
      plan,
      options.lockfileUpdater ?? defaultLockfileUpdater(plan.packageManager),
    );
  return Object.freeze({
    status: plan.unchanged ? "unchanged" : "created",
    gameId: plan.gameId,
    packageName: `@online-game-hub/${plan.gameId}`,
    gameDirectory: `games/${plan.gameId}`,
    surfacePackageName: `@online-game-hub/${plan.gameId}-surface`,
    surfaceDirectory: `game-surfaces/${plan.gameId}`,
    changedFiles: Object.freeze(
      plan.unchanged
        ? []
        : [
            ...plan.targets.flatMap((target) =>
              [...target.files.keys()].map(
                (file) => `${target.relativeDirectory}/${file}`,
              ),
            ),
            LOCKFILE_PATH,
          ].sort(),
    ),
  });
}
