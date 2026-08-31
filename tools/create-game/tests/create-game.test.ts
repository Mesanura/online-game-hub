import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createGame,
  CreateGameError,
  deriveGameSymbols,
} from "../src/index.ts";
import type { LockfileUpdater } from "../src/index.ts";
import {
  formatSuccess,
  HELP_TEXT,
  parseArguments,
  runCli,
} from "../src/cli.ts";
import type { CliIo, CliRuntime } from "../src/cli.ts";

const CATALOG = `// catalog fixture
// create-game:catalog-import
const gameCatalog = [
  // create-game:catalog-entry
];
`;

const CLIENT = `// client fixture
// create-game:client-manifest-import
// create-game:client-loader
const clientRegistrations = [
  // create-game:client-registration
];
`;

const SERVER = `// server fixture
// create-game:server-definition-import
const serverDefinitions = [
  // create-game:server-definition
];
`;

const NEXT_CONFIG = `const nextConfig = {
  transpilePackages: [
    // create-game:transpile-package
  ],
};
`;

interface Fixture {
  readonly root: string;
  readonly updateLockfile: LockfileUpdater;
  readonly lockfileCalls: () => number;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ogh-create-game-"));
  for (const directory of [
    "apps/web",
    "games",
    "packages/game-registry/src",
    "tooling",
    "tools",
  ]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  await writeJson(path.join(root, "package.json"), {
    name: "online-game-hub",
    private: true,
    packageManager: "pnpm@11.24.0",
  });
  await writeJson(path.join(root, "packages/game-registry/package.json"), {
    name: "@online-game-hub/game-registry",
    private: true,
    dependencies: {
      "@online-game-hub/game-sdk": "workspace:*",
    },
  });
  await writeFile(
    path.join(root, "packages/game-registry/src/catalog.ts"),
    CATALOG,
    "utf8",
  );
  await writeFile(
    path.join(root, "packages/game-registry/src/client.ts"),
    CLIENT,
    "utf8",
  );
  await writeFile(
    path.join(root, "packages/game-registry/src/server.ts"),
    SERVER,
    "utf8",
  );
  await writeFile(
    path.join(root, "apps/web/next.config.ts"),
    NEXT_CONFIG,
    "utf8",
  );
  await writeFile(
    path.join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n",
    "utf8",
  );

  let calls = 0;
  const updateLockfile: LockfileUpdater = async ({ workspaceRoot, gameId }) => {
    calls += 1;
    const lockfilePath = path.join(workspaceRoot, "pnpm-lock.yaml");
    const current = await readFile(lockfilePath, "utf8");
    await writeFile(
      lockfilePath,
      `${current}\n  games/${gameId}:\n    dependencies: {}\n`,
      "utf8",
    );
  };
  return { root, updateLockfile, lockfileCalls: () => calls };
}

async function withFixture(
  callback: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const fixture = await createFixture();
  try {
    await callback(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function snapshot(root: string): Promise<ReadonlyMap<string, string>> {
  const result = new Map<string, string>();
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        result.set(
          path.relative(root, absolute).replaceAll("\\", "/"),
          await readFile(absolute, "utf8"),
        );
      }
    }
  }
  await visit(root);
  return new Map(
    [...result].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function count(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

describe("createGame", () => {
  it("generates only the mechanical package skeleton and explicit registrations", async () => {
    await withFixture(async (fixture) => {
      const result = await createGame({
        workspaceRoot: fixture.root,
        gameId: "sample-game",
        lockfileUpdater: fixture.updateLockfile,
      });

      expect(result).toMatchObject({
        status: "created",
        gameId: "sample-game",
        packageName: "@online-game-hub/sample-game",
        gameDirectory: "games/sample-game",
      });
      expect(result.changedFiles).toEqual([...result.changedFiles].sort());
      expect(fixture.lockfileCalls()).toBe(1);

      const gameRoot = path.join(fixture.root, "games/sample-game");
      const packageManifest = JSON.parse(
        await readFile(path.join(gameRoot, "package.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(packageManifest).toMatchObject({
        name: "@online-game-hub/sample-game",
        exports: {
          "./manifest": {
            types: "./dist/manifest.d.ts",
            import: "./dist/manifest.js",
          },
          "./core": {
            types: "./dist/core/index.d.ts",
            import: "./dist/core/index.js",
          },
          "./client": {
            types: "./dist/client/index.d.ts",
            import: "./dist/client/index.js",
          },
        },
      });
      expect(
        JSON.parse(
          await readFile(path.join(gameRoot, "tsconfig.json"), "utf8"),
        ),
      ).toMatchObject({
        extends: "../../tsconfig.base.json",
        compilerOptions: { rootDir: "src" },
      });
      expect(
        JSON.parse(
          await readFile(path.join(gameRoot, "tsconfig.build.json"), "utf8"),
        ),
      ).toMatchObject({
        extends: "./tsconfig.json",
        compilerOptions: { outDir: "dist", noEmit: false },
      });
      expect(
        JSON.parse(
          await readFile(path.join(gameRoot, "tests/tsconfig.json"), "utf8"),
        ),
      ).toMatchObject({
        extends: "../tsconfig.json",
        compilerOptions: { rootDir: "..", types: ["node"] },
      });
      await expect(
        lstat(path.join(gameRoot, "src/core")),
      ).resolves.toMatchObject({});
      await expect(
        lstat(path.join(gameRoot, "src/client")),
      ).resolves.toMatchObject({});
      await expect(
        lstat(path.join(gameRoot, "tests/fixtures")),
      ).resolves.toMatchObject({});
      await expect(
        readFile(path.join(gameRoot, "src/manifest.ts"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(path.join(gameRoot, "src/core/index.ts"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(path.join(gameRoot, "src/client/index.ts"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const registryPackage = JSON.parse(
        await readFile(
          path.join(fixture.root, "packages/game-registry/package.json"),
          "utf8",
        ),
      ) as { dependencies: Record<string, string> };
      expect(registryPackage.dependencies["@online-game-hub/sample-game"]).toBe(
        "workspace:*",
      );
      const symbols = deriveGameSymbols("sample-game");
      const catalog = await readFile(
        path.join(fixture.root, "packages/game-registry/src/catalog.ts"),
        "utf8",
      );
      const client = await readFile(
        path.join(fixture.root, "packages/game-registry/src/client.ts"),
        "utf8",
      );
      const server = await readFile(
        path.join(fixture.root, "packages/game-registry/src/server.ts"),
        "utf8",
      );
      const nextConfig = await readFile(
        path.join(fixture.root, "apps/web/next.config.ts"),
        "utf8",
      );
      expect(catalog).toContain(
        `import { ${symbols.manifest} } from "@online-game-hub/sample-game/manifest";`,
      );
      expect(catalog).toContain(`  ${symbols.manifest},`);
      expect(client).toContain("@online-game-hub/sample-game/client");
      expect(client).toContain(symbols.clientModule);
      expect(server).toContain(
        `import { ${symbols.definition} } from "@online-game-hub/sample-game/core";`,
      );
      expect(server).toContain(`eraseGameDefinition(${symbols.definition})`);
      expect(nextConfig).toContain('"@online-game-hub/sample-game",');
    });
  });

  it("is idempotent and does not duplicate any explicit registration", async () => {
    await withFixture(async (fixture) => {
      const options = {
        workspaceRoot: fixture.root,
        gameId: "repeatable-game",
        lockfileUpdater: fixture.updateLockfile,
      };
      await createGame(options);
      const before = await snapshot(fixture.root);
      const second = await createGame(options);
      const after = await snapshot(fixture.root);

      expect(second.status).toBe("unchanged");
      expect(second.changedFiles).toEqual([]);
      expect(after).toEqual(before);
      expect(fixture.lockfileCalls()).toBe(1);

      const packageName = "@online-game-hub/repeatable-game";
      const registryPackage = await readFile(
        path.join(fixture.root, "packages/game-registry/package.json"),
        "utf8",
      );
      const catalog = await readFile(
        path.join(fixture.root, "packages/game-registry/src/catalog.ts"),
        "utf8",
      );
      const client = await readFile(
        path.join(fixture.root, "packages/game-registry/src/client.ts"),
        "utf8",
      );
      const server = await readFile(
        path.join(fixture.root, "packages/game-registry/src/server.ts"),
        "utf8",
      );
      const nextConfig = await readFile(
        path.join(fixture.root, "apps/web/next.config.ts"),
        "utf8",
      );
      expect(count(registryPackage, packageName)).toBe(1);
      expect(count(catalog, `${packageName}/manifest`)).toBe(1);
      expect(count(client, `${packageName}/manifest`)).toBe(1);
      expect(count(client, `${packageName}/client`)).toBe(1);
      expect(count(server, `${packageName}/core`)).toBe(1);
      expect(count(nextConfig, packageName)).toBe(1);
    });
  });

  it.each([
    "",
    "Uppercase",
    "two--segments",
    "-leading",
    "trailing-",
    "../escape",
    "games/escape",
    "C:\\escape",
    "con",
    "node_modules",
    "api",
  ])(
    "rejects invalid or reserved gameId %j with zero writes",
    async (gameId) => {
      await withFixture(async (fixture) => {
        const before = await snapshot(fixture.root);
        await expect(
          createGame({
            workspaceRoot: fixture.root,
            gameId,
            lockfileUpdater: fixture.updateLockfile,
          }),
        ).rejects.toMatchObject({
          name: "CreateGameError",
          code: "INVALID_GAME_ID",
          exitCode: 2,
        });
        expect(await snapshot(fixture.root)).toEqual(before);
        expect(fixture.lockfileCalls()).toBe(0);
      });
    },
  );

  it("fails closed for an existing non-generator directory", async () => {
    await withFixture(async (fixture) => {
      await mkdir(path.join(fixture.root, "games/existing-game"));
      await writeFile(
        path.join(fixture.root, "games/existing-game/notes.txt"),
        "user content\n",
        "utf8",
      );
      const before = await snapshot(fixture.root);
      await expect(
        createGame({
          workspaceRoot: fixture.root,
          gameId: "existing-game",
          lockfileUpdater: fixture.updateLockfile,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", exitCode: 2 });
      expect(await snapshot(fixture.root)).toEqual(before);
    });
  });

  it("rejects package, gameId, and derived symbol collisions", async () => {
    await withFixture(async (fixture) => {
      await writeJson(
        path.join(fixture.root, "packages/package-owner/package.json"),
        {
          name: "@online-game-hub/package-clash",
        },
      );
      await expect(
        createGame({
          workspaceRoot: fixture.root,
          gameId: "package-clash",
          lockfileUpdater: fixture.updateLockfile,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      await mkdir(path.join(fixture.root, "games/legacy/src"), {
        recursive: true,
      });
      await writeFile(
        path.join(fixture.root, "games/legacy/src/manifest.ts"),
        'const id = defineGameId("claimed-id");\n',
        "utf8",
      );
      await expect(
        createGame({
          workspaceRoot: fixture.root,
          gameId: "claimed-id",
          lockfileUpdater: fixture.updateLockfile,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      await mkdir(path.join(fixture.root, "games/a1"));
      await expect(
        createGame({
          workspaceRoot: fixture.root,
          gameId: "a-1",
          lockfileUpdater: fixture.updateLockfile,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(fixture.lockfileCalls()).toBe(0);
    });
  });

  it("rejects partial or duplicate registration without additional writes", async () => {
    await withFixture(async (fixture) => {
      const registryPackagePath = path.join(
        fixture.root,
        "packages/game-registry/package.json",
      );
      const registryPackage = JSON.parse(
        await readFile(registryPackagePath, "utf8"),
      ) as { dependencies: Record<string, string> };
      registryPackage.dependencies["@online-game-hub/partial-game"] =
        "workspace:*";
      await writeJson(registryPackagePath, registryPackage);
      const beforePartial = await snapshot(fixture.root);
      await expect(
        createGame({
          workspaceRoot: fixture.root,
          gameId: "partial-game",
          lockfileUpdater: fixture.updateLockfile,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", exitCode: 2 });
      expect(await snapshot(fixture.root)).toEqual(beforePartial);

      const catalogPath = path.join(
        fixture.root,
        "packages/game-registry/src/catalog.ts",
      );
      const duplicateImport =
        'import { duplicateGameManifest } from "@online-game-hub/duplicate-game/manifest";\n';
      await writeFile(
        catalogPath,
        `${duplicateImport}${duplicateImport}${CATALOG}`,
        "utf8",
      );
      const beforeDuplicate = await snapshot(fixture.root);
      await expect(
        createGame({
          workspaceRoot: fixture.root,
          gameId: "duplicate-game",
          lockfileUpdater: fixture.updateLockfile,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", exitCode: 2 });
      expect(await snapshot(fixture.root)).toEqual(beforeDuplicate);
      expect(fixture.lockfileCalls()).toBe(0);
    });
  });

  it("rolls back every planned write when the pnpm lockfile update fails", async () => {
    await withFixture(async (fixture) => {
      const before = await snapshot(fixture.root);
      const failingUpdater: LockfileUpdater = async ({
        workspaceRoot,
        gameId,
      }) => {
        await writeFile(
          path.join(workspaceRoot, "pnpm-lock.yaml"),
          `importers:\n\n  games/${gameId}: {}\n`,
          "utf8",
        );
        throw new Error("fixture pnpm failure");
      };
      await expect(
        createGame({
          workspaceRoot: fixture.root,
          gameId: "rollback-game",
          lockfileUpdater: failingUpdater,
        }),
      ).rejects.toMatchObject({
        code: "LOCKFILE_UPDATE_FAILED",
        exitCode: 1,
      });
      expect(await snapshot(fixture.root)).toEqual(before);
    });
  });
});

describe("CLI contract", () => {
  function capture(): {
    readonly io: CliIo;
    readonly stdout: () => string;
    readonly stderr: () => string;
  } {
    let out = "";
    let error = "";
    return {
      io: {
        stdout: (text) => {
          out += text;
        },
        stderr: (text) => {
          error += text;
        },
      },
      stdout: () => out,
      stderr: () => error,
    };
  }

  it("prints stable help with exit code 0", async () => {
    const output = capture();
    const runtime: CliRuntime = {
      workspaceRoot: () => "unused",
      createGame: async () => {
        throw new Error("help must not generate");
      },
    };
    await expect(runCli(["--help"], output.io, runtime)).resolves.toBe(0);
    expect(output.stdout()).toBe(HELP_TEXT);
    expect(output.stderr()).toBe("");
    expect(HELP_TEXT.endsWith("\n")).toBe(true);
  });

  it("uses exit code 2 for missing or malformed arguments", async () => {
    expect(() => parseArguments(["--unknown"])).toThrow(CreateGameError);
    const output = capture();
    const runtime: CliRuntime = {
      workspaceRoot: () => "unused",
      createGame: async () => {
        throw new Error("invalid arguments must not generate");
      },
    };
    await expect(runCli([], output.io, runtime)).resolves.toBe(2);
    expect(output.stdout()).toBe("");
    expect(output.stderr()).toBe(
      "错误 [INVALID_ARGUMENTS]：缺少必填参数 --game-id <id>。\n运行 pnpm create-game --help 查看稳定参数契约。\n",
    );
  });

  it("uses stable ordered output and exit codes for success and failure", async () => {
    const successOutput = capture();
    const successResult = {
      status: "created" as const,
      gameId: "sample-game",
      packageName: "@online-game-hub/sample-game",
      gameDirectory: "games/sample-game",
      changedFiles: ["a", "b"],
    };
    const successRuntime: CliRuntime = {
      workspaceRoot: () => "fixture-root",
      createGame: async (options) => {
        expect(options).toEqual({
          workspaceRoot: "fixture-root",
          gameId: "sample-game",
        });
        return successResult;
      },
    };
    await expect(
      runCli(["--game-id", "sample-game"], successOutput.io, successRuntime),
    ).resolves.toBe(0);
    expect(successOutput.stdout()).toBe(formatSuccess(successResult));
    expect(successOutput.stdout()).toContain(
      "变更文件（稳定排序）：\n- a\n- b\n",
    );
    expect(successOutput.stdout().endsWith("\n")).toBe(true);
    expect(successOutput.stderr()).toBe("");

    const failedOutput = capture();
    const failedRuntime: CliRuntime = {
      workspaceRoot: () => "fixture-root",
      createGame: async () => {
        throw new CreateGameError("CONFLICT", "fixture conflict", 2);
      },
    };
    await expect(
      runCli(["--game-id", "sample-game"], failedOutput.io, failedRuntime),
    ).resolves.toBe(2);
    expect(failedOutput.stdout()).toBe("");
    expect(failedOutput.stderr()).toBe(
      "错误 [CONFLICT]：fixture conflict\n运行 pnpm create-game --help 查看稳定参数契约。\n",
    );
  });
});
