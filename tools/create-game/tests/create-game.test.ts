import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type * as Fs from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

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

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof Fs>();
  return { ...fs, mkdir: vi.fn(fs.mkdir), writeFile: vi.fn(fs.writeFile) };
});
const actualFs = await vi.importActual<typeof Fs>("node:fs/promises");

afterEach(() => {
  vi.mocked(mkdir).mockReset().mockImplementation(actualFs.mkdir);
  vi.mocked(writeFile).mockReset().mockImplementation(actualFs.writeFile);
});

const BUSINESS_FILES = new Map([
  [
    "packages/game-registry/package.json",
    JSON.stringify({
      name: "@online-game-hub/game-registry",
      dependencies: { "@online-game-hub/game-sdk": "workspace:*" },
    }) + "\n",
  ],
  ["packages/game-registry/src/catalog.ts", "export const gameCatalog = [];\n"],
  ["packages/game-registry/src/server.ts", "const definitions = [];\n"],
  ["packages/game-registry/src/deployment.ts", "const deployments = [];\n"],
  ["apps/web/next.config.ts", "const config = { transpilePackages: [] };\n"],
  ["Dockerfile", "FROM node:24.14.0\n"],
]);
const ORIGINAL_LOCKFILE = "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n";

interface Fixture {
  readonly root: string;
  readonly updateLockfile: LockfileUpdater;
  readonly lockfileCalls: () => number;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ogh-create-game-"));
  for (const directory of [
    "apps/web",
    "games",
    "game-surfaces",
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
  for (const [file, content] of BUSINESS_FILES)
    await writeFile(path.join(root, file), content, "utf8");
  await writeFile(path.join(root, "pnpm-lock.yaml"), ORIGINAL_LOCKFILE, "utf8");
  let calls = 0;
  const updateLockfile: LockfileUpdater = async ({
    workspaceRoot,
    gameId,
    packageManager,
  }) => {
    expect(packageManager).toBe("pnpm@11.24.0");
    calls += 1;
    const lockfilePath = path.join(workspaceRoot, "pnpm-lock.yaml");
    const current = await readFile(lockfilePath, "utf8");
    await writeFile(
      lockfilePath,
      current + `\n  games/${gameId}: {}\n  game-surfaces/${gameId}: {}\n`,
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
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) {
        result.set(relative, "link:" + (await readlink(absolute)));
      } else if (entry.isDirectory()) {
        result.set(relative + "/", "");
        await visit(absolute);
      } else {
        result.set(relative, await readFile(absolute, "utf8"));
      }
    }
  }
  await visit(root);
  return new Map(
    [...result].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function options(fixture: Fixture, gameId = "sample-game") {
  return {
    workspaceRoot: fixture.root,
    gameId,
    lockfileUpdater: fixture.updateLockfile,
  };
}

async function expectZeroWrites(
  fixture: Fixture,
  gameId = "sample-game",
  code = "CONFLICT",
): Promise<void> {
  const before = await snapshot(fixture.root);
  const previousCalls = fixture.lockfileCalls();
  vi.mocked(writeFile).mockClear();
  vi.mocked(mkdir).mockClear();
  await expect(createGame(options(fixture, gameId))).rejects.toMatchObject({
    code,
    exitCode: 2,
  });
  expect(await snapshot(fixture.root)).toEqual(before);
  expect(fixture.lockfileCalls()).toBe(previousCalls);
  expect(writeFile).not.toHaveBeenCalled();
  expect(mkdir).not.toHaveBeenCalled();
}

describe("createGame", () => {
  it("generates compilable V6 and Bridge V2 drafts without business registrations or fake tests", async () => {
    await withFixture(async (fixture) => {
      const before = await snapshot(fixture.root);
      const result = await createGame(options(fixture));
      expect(result).toMatchObject({
        status: "created",
        gameId: "sample-game",
        packageName: "@online-game-hub/sample-game",
        gameDirectory: "games/sample-game",
        surfacePackageName: "@online-game-hub/sample-game-surface",
        surfaceDirectory: "game-surfaces/sample-game",
      });
      expect(result.changedFiles).toEqual([...result.changedFiles].sort());
      expect(fixture.lockfileCalls()).toBe(1);
      const after = await snapshot(fixture.root);
      for (const [file, content] of before) {
        if (file !== "pnpm-lock.yaml") expect(after.get(file)).toBe(content);
      }
      const changed = [...after]
        .filter(
          ([file, content]) =>
            !file.endsWith("/") && before.get(file) !== content,
        )
        .map(([file]) => file)
        .sort();
      expect(result.changedFiles).toEqual(changed);
      expect(
        changed.every(
          (file) =>
            file === "pnpm-lock.yaml" ||
            file.startsWith("games/sample-game/") ||
            file.startsWith("game-surfaces/sample-game/"),
        ),
      ).toBe(true);

      const game = JSON.parse(
        after.get("games/sample-game/package.json") ?? "",
      ) as {
        exports: Record<string, unknown>;
        scripts: Record<string, string>;
      };
      expect(Object.keys(game.exports)).toEqual([
        "./manifest",
        "./core",
        "./setup",
      ]);
      expect(game.exports["./setup"]).toEqual({
        types: "./dist/setup/index.d.ts",
        import: "./dist/setup/index.js",
      });
      expect(Object.keys(game.scripts).sort()).toEqual(["build", "typecheck"]);
      for (const file of ["manifest.ts", "core/index.ts", "setup/index.ts"]) {
        expect(after.get("games/sample-game/src/" + file)).toContain(
          "export {};",
        );
      }
      const surface = JSON.parse(
        after.get("game-surfaces/sample-game/package.json") ?? "",
      ) as {
        scripts: Record<string, string>;
        dependencies: Record<string, string>;
      };
      expect(surface).toMatchObject({
        onlineGameHub: { surfaceArtifact: false },
      });
      expect(Object.keys(surface.scripts).sort()).toEqual([
        "build",
        "dev",
        "typecheck",
      ]);
      expect(surface.scripts.build).toBe("vite build");
      expect(Object.keys(surface.dependencies)).toEqual([
        "@online-game-hub/game-surface-bridge",
      ]);
      for (const mode of ["setup", "play"])
        expect(
          after.get(`game-surfaces/sample-game/${mode}/index.html`),
        ).toContain("尚未实现");
      for (const file of [
        "surface.config.json",
        "surface.lock.json",
        "dist/surface-manifest.json",
      ]) {
        expect(after.has("game-surfaces/sample-game/" + file)).toBe(false);
      }
      expect(after.get("games/sample-game/README.md")).toContain("Dockerfile");
      expect(after.get("games/sample-game/tests/README.md")).toContain("规则");
      expect(after.get("games/sample-game/tests/fixtures/README.md")).toContain(
        "canonical replay",
      );
      expect(after.get("game-surfaces/sample-game/tests/README.md")).toContain(
        "contract-test",
      );
    });
  });

  it("repeats a complete two-package draft with zero writes and stable results", async () => {
    await withFixture(async (fixture) => {
      const first = await createGame(options(fixture));
      const before = await snapshot(fixture.root);
      vi.mocked(writeFile).mockClear();
      vi.mocked(mkdir).mockClear();
      const second = await createGame(options(fixture));
      expect(second).toEqual({
        ...first,
        status: "unchanged",
        changedFiles: [],
      });
      expect(await snapshot(fixture.root)).toEqual(before);
      expect(fixture.lockfileCalls()).toBe(1);
      expect(writeFile).not.toHaveBeenCalled();
      expect(mkdir).not.toHaveBeenCalled();
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
  ])("rejects invalid or reserved id %j", async (id) => {
    await withFixture(async (fixture) => {
      await expectZeroWrites(fixture, id, "INVALID_GAME_ID");
    });
  });

  it("derives manifest, Core and Setup symbols", () => {
    expect(deriveGameSymbols("sample-game")).toEqual({
      base: "sampleGame",
      pascal: "SampleGame",
      manifest: "sampleGameManifest",
      definition: "sampleGameDefinition",
      setupDefinition: "sampleGameSetupDefinition",
    });
  });

  it.each([
    ["packages/owner", "@online-game-hub/sample-game"],
    ["game-surfaces/owner", "@online-game-hub/sample-game"],
    ["game-surfaces/owner", "@online-game-hub/sample-game-surface"],
    ["games/sample-game-surface", "@online-game-hub/sample-game-surface"],
  ])("rejects a package name owned by %s (%s)", async (directory, name) => {
    await withFixture(async (fixture) => {
      await writeJson(path.join(fixture.root, directory, "package.json"), {
        name,
      });
      await expectZeroWrites(fixture);
    });
  });

  it("rejects the reverse collision with an existing Surface package", async () => {
    await withFixture(async (fixture) => {
      await createGame(options(fixture));
      await expectZeroWrites(fixture, "sample-game-surface");
    });
  });

  it("rejects manifest gameIds and derived symbols already owned by other games", async () => {
    await withFixture(async (fixture) => {
      await mkdir(path.join(fixture.root, "games/legacy/src"), {
        recursive: true,
      });
      await writeFile(
        path.join(fixture.root, "games/legacy/src/manifest.ts"),
        'const id = defineGameId("sample-game");\n',
      );
      await expectZeroWrites(fixture);
      await mkdir(path.join(fixture.root, "games/a1"));
      await expectZeroWrites(fixture, "a-1");
    });
  });

  it.each([
    [
      "packages/game-registry/package.json",
      '{"dependencies":{"@online-game-hub/sample-game":"workspace:*"}}',
    ],
    [
      "packages/game-registry/src/catalog.ts",
      'import { sampleGameManifest } from "@online-game-hub/elsewhere/manifest";',
    ],
    [
      "packages/game-registry/src/server.ts",
      "const sampleGameSetupDefinition = {};",
    ],
    [
      "packages/game-registry/src/deployment.ts",
      'const entry = "@online-game-hub/sample-game-surface";',
    ],
  ])("rejects existing explicit registrations in %s", async (file, content) => {
    await withFixture(async (fixture) => {
      await writeFile(path.join(fixture.root, file), content);
      await expectZeroWrites(fixture);
    });
  });

  it("does not confuse longer package names or symbols with exact collisions", async () => {
    await withFixture(async (fixture) => {
      await writeFile(
        path.join(fixture.root, "packages/game-registry/src/catalog.ts"),
        'import { sampleGameExtraManifest } from "@online-game-hub/sample-game-extra/manifest";',
      );
      await expect(createGame(options(fixture))).resolves.toMatchObject({
        status: "created",
      });
    });
  });

  it.each(["games/sample-game", "game-surfaces/sample-game"])(
    "rejects a partial preexisting target %s",
    async (directory) => {
      await withFixture(async (fixture) => {
        await mkdir(path.join(fixture.root, directory));
        await writeFile(
          path.join(fixture.root, directory, "notes.txt"),
          "user content\n",
        );
        await expectZeroWrites(fixture);
      });
    },
  );

  it.each(["games/sample-game", "game-surfaces/sample-game"])(
    "rejects a missing target %s without repairing its partner",
    async (directory) => {
      await withFixture(async (fixture) => {
        await createGame(options(fixture));
        await rm(path.join(fixture.root, directory), { recursive: true });
        await expectZeroWrites(fixture);
      });
    },
  );

  it.each(["games/sample-game", "game-surfaces/sample-game"])(
    "rejects a missing lockfile importer %s",
    async (directory) => {
      await withFixture(async (fixture) => {
        await createGame(options(fixture));
        const lockPath = path.join(fixture.root, "pnpm-lock.yaml");
        const lock = await readFile(lockPath, "utf8");
        await writeFile(lockPath, lock.replace(`  ${directory}: {}\n`, ""));
        await expectZeroWrites(fixture);
      });
    },
  );

  it("rejects stale importers even when both directories are absent", async () => {
    await withFixture(async (fixture) => {
      await writeFile(
        path.join(fixture.root, "pnpm-lock.yaml"),
        ORIGINAL_LOCKFILE +
          "\n  games/sample-game: {}\n  game-surfaces/sample-game: {}\n",
      );
      await expectZeroWrites(fixture);
    });
  });

  it.each([
    "games/sample-game/src/core/index.ts",
    "game-surfaces/sample-game/play/index.html",
  ])("preserves user edits in %s", async (file) => {
    await withFixture(async (fixture) => {
      await createGame(options(fixture));
      await writeFile(path.join(fixture.root, file), "user implementation\n");
      await expectZeroWrites(fixture);
    });
  });

  it.each([
    "games",
    "game-surfaces",
    "games/sample-game",
    "game-surfaces/sample-game",
    "games/sample-game/src/core",
    "game-surfaces/sample-game/src",
  ])("rejects linked parent/target directories: %s", async (directory) => {
    await withFixture(async (fixture) => {
      const destination = path.join(fixture.root, "outside");
      await mkdir(destination);
      await writeFile(path.join(destination, "keep.txt"), "untouched\n");
      if (directory.split("/").length > 2) await createGame(options(fixture));
      const link = path.join(fixture.root, directory);
      await rm(link, { recursive: true, force: true });
      await symlink(
        destination,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
      await expectZeroWrites(fixture);
    });
  });

  it.each([
    "games/sample-game/package.json",
    "game-surfaces/sample-game/play/index.html",
  ])("rejects a non-file at owned path %s", async (file) => {
    await withFixture(async (fixture) => {
      await createGame(options(fixture));
      await rm(path.join(fixture.root, file));
      await mkdir(path.join(fixture.root, file));
      await expectZeroWrites(fixture);
    });
  });

  it.each([
    "games/sample-game/src/core/index.ts",
    "game-surfaces/sample-game/src/play.ts",
  ])("rolls back both packages after write failure at %s", async (file) => {
    await withFixture(async (fixture) => {
      const before = await snapshot(fixture.root);
      const failurePath = path.join(fixture.root, file);
      vi.mocked(writeFile).mockImplementation(async (...args) => {
        if (args[0] === failurePath) throw new Error("fixture disk failure");
        await actualFs.writeFile(...args);
      });
      await expect(createGame(options(fixture))).rejects.toMatchObject({
        code: "WRITE_FAILED",
        exitCode: 1,
      });
      expect(await snapshot(fixture.root)).toEqual(before);
      expect(fixture.lockfileCalls()).toBe(0);
    });
  });

  it.each(["throw", "no-importer", "one-importer", "deleted-lockfile"])(
    "restores the original lockfile and both directories on updater failure: %s",
    async (failure) => {
      await withFixture(async (fixture) => {
        const before = await snapshot(fixture.root);
        const updater: LockfileUpdater = async ({ workspaceRoot }) => {
          const lock = path.join(workspaceRoot, "pnpm-lock.yaml");
          if (failure === "deleted-lockfile") await rm(lock);
          else
            await writeFile(
              lock,
              failure === "no-importer"
                ? ORIGINAL_LOCKFILE
                : ORIGINAL_LOCKFILE + "\n  games/sample-game: {}\n",
            );
          if (failure === "throw") throw new Error("fixture pnpm failure");
        };
        await expect(
          createGame({ ...options(fixture), lockfileUpdater: updater }),
        ).rejects.toMatchObject({
          code: "LOCKFILE_UPDATE_FAILED",
          exitCode: 1,
        });
        expect(await snapshot(fixture.root)).toEqual(before);
      });
    },
  );

  it("does not remove a second target created concurrently by someone else", async () => {
    await withFixture(async (fixture) => {
      const target = path.join(fixture.root, "game-surfaces/sample-game");
      vi.mocked(mkdir).mockImplementation(async (...args) => {
        if (args[0] === target) {
          await actualFs.mkdir(target);
          await actualFs.writeFile(
            path.join(target, "keep.txt"),
            "concurrent user file\n",
          );
        }
        return actualFs.mkdir(...args);
      });
      await expect(createGame(options(fixture))).rejects.toMatchObject({
        code: "WRITE_FAILED",
        exitCode: 1,
      });
      expect(await readFile(path.join(target, "keep.txt"), "utf8")).toBe(
        "concurrent user file\n",
      );
      await expect(
        lstat(path.join(fixture.root, "games/sample-game")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        await readFile(path.join(fixture.root, "pnpm-lock.yaml"), "utf8"),
      ).toBe(ORIGINAL_LOCKFILE);
      expect(fixture.lockfileCalls()).toBe(0);
    });
  });

  it("preserves a lockfile changed after preflight and rolls back only generated targets", async () => {
    await withFixture(async (fixture) => {
      const concurrent = ORIGINAL_LOCKFILE + "# user update\n";
      vi.mocked(writeFile).mockImplementation(async (...args) => {
        await actualFs.writeFile(...args);
        if (
          args[0] ===
          path.join(fixture.root, "game-surfaces/sample-game/src/play.ts")
        ) {
          await actualFs.writeFile(
            path.join(fixture.root, "pnpm-lock.yaml"),
            concurrent,
          );
        }
      });
      await expect(createGame(options(fixture))).rejects.toMatchObject({
        code: "WRITE_FAILED",
        exitCode: 1,
      });
      expect(
        await readFile(path.join(fixture.root, "pnpm-lock.yaml"), "utf8"),
      ).toBe(concurrent);
      expect(await readdir(path.join(fixture.root, "games"))).toEqual([]);
      expect(await readdir(path.join(fixture.root, "game-surfaces"))).toEqual(
        [],
      );
      expect(fixture.lockfileCalls()).toBe(0);
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

  it("prints help with exit code 0 without workspace access", async () => {
    const output = capture();
    const runtime: CliRuntime = {
      workspaceRoot: () => {
        throw new Error("help must not inspect the workspace");
      },
      createGame: async () => {
        throw new Error("help must not generate");
      },
    };
    await expect(runCli(["--help"], output.io, runtime)).resolves.toBe(0);
    expect(output.stdout()).toBe(HELP_TEXT);
    expect(output.stderr()).toBe("");
    expect(HELP_TEXT).toContain("Bridge V2");
  });

  it.each(
    [
      [],
      ["--unknown"],
      ["--game-id"],
      ["--game-id", "--bad"],
      ["--game-id", "a", "--game-id", "b"],
    ].map((args) => ({ args })),
  )("rejects malformed arguments $args with exit code 2", async ({ args }) => {
    expect(() => parseArguments(args)).toThrow(CreateGameError);
    const output = capture();
    await expect(
      runCli(args, output.io, {
        workspaceRoot: () => "unused",
        createGame: async () => {
          throw new Error("invalid arguments must not generate");
        },
      }),
    ).resolves.toBe(2);
    expect(output.stdout()).toBe("");
    expect(output.stderr()).toContain("错误 [INVALID_ARGUMENTS]");
  });

  it("prints both directories and explicit promotion steps after success", async () => {
    const output = capture();
    const result = {
      status: "created" as const,
      gameId: "sample-game",
      packageName: "@online-game-hub/sample-game",
      gameDirectory: "games/sample-game",
      surfacePackageName: "@online-game-hub/sample-game-surface",
      surfaceDirectory: "game-surfaces/sample-game",
      changedFiles: ["a", "b"],
    };
    await expect(
      runCli(["--game-id", "sample-game"], output.io, {
        workspaceRoot: () => "fixture-root",
        createGame: async (input) => {
          expect(input).toEqual({
            workspaceRoot: "fixture-root",
            gameId: "sample-game",
          });
          return result;
        },
      }),
    ).resolves.toBe(0);
    expect(output.stdout()).toBe(formatSuccess(result));
    expect(output.stdout()).toContain("变更文件（稳定排序）：\n- a\n- b\n");
    for (const text of [
      "game-surfaces/sample-game",
      "未发布",
      "registry dependencies",
      "Dockerfile",
      "surface.lock.json",
    ])
      expect(output.stdout()).toContain(text);
    expect(output.stderr()).toBe("");
    expect(
      formatSuccess({ ...result, status: "unchanged", changedFiles: [] }),
    ).toContain("本次幂等运行没有写入");
  });

  it.each([
    new CreateGameError("CONFLICT", "fixture conflict", 2),
    new CreateGameError("WRITE_FAILED", "fixture failure", 1),
    new CreateGameError(
      "LOCKFILE_UPDATE_FAILED",
      "fixture lockfile failure",
      1,
    ),
  ])("preserves exit code for $code", async (failure) => {
    const output = capture();
    await expect(
      runCli(["--game-id", "sample-game"], output.io, {
        workspaceRoot: () => "fixture-root",
        createGame: async () => {
          throw failure;
        },
      }),
    ).resolves.toBe(failure.exitCode);
    expect(output.stdout()).toBe("");
    expect(output.stderr()).toContain(
      `错误 [${failure.code}]：${failure.message}\n`,
    );
    if (failure.exitCode === 1)
      expect(output.stderr()).toContain(
        "games/<id>、game-surfaces/<id> 与 pnpm-lock.yaml",
      );
  });
});
