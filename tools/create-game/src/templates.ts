export interface GeneratedPackage {
  readonly relativeDirectory: string;
  readonly packageName: string;
  readonly files: ReadonlyMap<string, string>;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const promotionChecklist = `
## 正式接入

1. 在 GAME_SPEC.md 中确认名称、规则、人数、Config、版本与 replay 能力，再实现 manifest、纯 Core 和 V6 Setup。
2. 通过 Bridge V2 实现独立 Setup/Play；选择 player-playback 时补充 Replay 入口，保持 exact 历史版本解析。
3. 添加真实的 unit、Setup、golden、Surface contract、integration 与 PostgreSQL-backed E2E；为两个包补齐相应 test、test:golden 和 contract-test 命令。
4. 在 Surface 中编写 surface.config.json，显式指定 gameVersion、surfaceVersion、bridgeVersion: 2、入口与能力；将 onlineGameHub.surfaceArtifact 改为 true。
5. 参照现有 Surface 添加 artifact:lock、带 finalize 的 build 及验证制品的 contract-test，生成并审查 surface.lock.json。普通 build 不得自动更新锁。
6. 手动增加 registry 的游戏依赖、catalog、exact Core/Setup resolver 与 deployment Surface 映射；仅在实际需要时调整 Next transpilePackages。
7. 在 Dockerfile 的依赖安装阶段补充两个新包的 package.json COPY，验证生产构建与不可变制品发布。
8. 完成 [Plugin Definition of Done](../../docs/GAME_PLUGIN_SPEC.md#13-plugin-definition-of-done) 和 [测试矩阵](../../docs/TESTING.md)，再提交正式登记。

依赖通过 workspace root 的固定 pnpm 增加并更新 lockfile。生成成功不代表完成游戏接入。
`;

function gameFiles(gameId: string): ReadonlyMap<string, string> {
  return new Map([
    [
      "package.json",
      json({
        name: `@online-game-hub/${gameId}`,
        version: "0.0.0",
        private: true,
        type: "module",
        sideEffects: false,
        files: ["dist"],
        exports: {
          "./manifest": {
            types: "./dist/manifest.d.ts",
            import: "./dist/manifest.js",
          },
          "./core": {
            types: "./dist/core/index.d.ts",
            import: "./dist/core/index.js",
          },
          "./setup": {
            types: "./dist/setup/index.d.ts",
            import: "./dist/setup/index.js",
          },
        },
        scripts: {
          build: "tsc -p tsconfig.build.json",
          typecheck: "tsc -p tsconfig.json",
        },
        dependencies: {
          "@online-game-hub/game-sdk": "workspace:*",
          "@online-game-hub/game-setup": "workspace:*",
          zod: "4.4.3",
        },
        devDependencies: { typescript: "6.0.3" },
      }),
    ],
    [
      "tsconfig.json",
      json({
        extends: "../../tsconfig.base.json",
        compilerOptions: { rootDir: "src", types: [] },
        include: ["src/**/*.ts"],
      }),
    ],
    [
      "tsconfig.build.json",
      json({
        extends: "./tsconfig.json",
        compilerOptions: {
          declaration: true,
          declarationMap: true,
          noEmit: false,
          outDir: "dist",
          rootDir: "src",
          sourceMap: true,
          tsBuildInfoFile: "dist/.tsbuildinfo",
        },
      }),
    ],
    [
      "src/manifest.ts",
      "// TODO: Define the manifest after GAME_SPEC.md is agreed.\nexport {};\n",
    ],
    [
      "src/core/index.ts",
      "// TODO: Implement the deterministic turn-based Core.\nexport {};\n",
    ],
    [
      "src/setup/index.ts",
      "// TODO: Implement a pure V6 RoundSetupDefinition.\nexport {};\n",
    ],
    [
      "README.md",
      `# ${gameId}

> 未完成的回合制开发草稿，尚未登记到游戏目录。

Core、manifest 与 Setup 当前是可编译的空模块，没有玩法或可创建的房间。画面草稿位于 [独立 Surface](../../game-surfaces/${gameId}/README.md)。

目前只提供 build/typecheck；测试目录中的说明文件不计作测试，也不会生成空通过的测试命令。
${promotionChecklist}`,
    ],
    [
      "GAME_SPEC.md",
      `# ${gameId} 规则草案

状态：未定义。以下内容由游戏负责人确认；草稿不声明游戏版本或 replay 能力。

- 产品名称、介绍与参与人数。
- Config、初始状态、操作、合法性与终局规则。
- V6 Setup 的设置、权限、参与者、顺序及 finalize 结果。
- 每位玩家可见的 View 和最小 intent。
- 随机性、确定性、历史版本与 replay 能力。
- 验收用例、键盘与触屏操作、可访问性。
`,
    ],
    [
      "AGENTS.md",
      `# ${gameId} 开发约束

遵守[仓库约束](../../AGENTS.md)，实现前完善 [GAME_SPEC.md](./GAME_SPEC.md)。

- 当前为未登记草稿，完成 Plugin Definition of Done 后才进入 registry。
- manifest、Core 与 Setup 保持纯 TypeScript、确定性与 JSON 可序列化；不依赖 React、DOM、网络、数据库或时钟。
- 客户端只提交 intent，服务器裁定规则；所有出站 View 必须经过 projectView。
- 游戏画面属于独立 Surface，通过 Bridge V2 工作，不添加旧 Client Module。
- 用真实规则测试与 golden 验证实现；没有规则时不编造测试或 replay。
`,
    ],
    [
      "tests/README.md",
      "# 规则测试待实现\n\n规则确定后添加 Core/Setup 的合法、非法、终局、不变性、序列化、projection 和 seeded determinism 测试，再添加 test 命令。正式接入要求真实测试通过。\n",
    ],
    [
      "tests/fixtures/README.md",
      "# Golden fixtures 待实现\n\n为每个支持的规则版本制作并审查真实 canonical replay，添加 test:golden 命令。不要用占位记录声明 replay 验证通过。\n",
    ],
  ]);
}

function surfaceFiles(gameId: string): ReadonlyMap<string, string> {
  const files = new Map<string, string>([
    [
      "package.json",
      json({
        name: `@online-game-hub/${gameId}-surface`,
        version: "0.0.0",
        private: true,
        type: "module",
        onlineGameHub: { surfaceArtifact: false },
        scripts: {
          build: "vite build",
          dev: "vite --host 127.0.0.1",
          typecheck: "tsc --noEmit",
        },
        dependencies: { "@online-game-hub/game-surface-bridge": "workspace:*" },
        devDependencies: {
          "@types/node": "24.13.3",
          typescript: "6.0.3",
          vite: "8.2.2",
        },
      }),
    ],
    [
      "tsconfig.json",
      json({
        extends: "../../tsconfig.base.json",
        compilerOptions: {
          lib: ["ES2023", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "Bundler",
          types: ["vite/client", "node"],
        },
        include: ["src/**/*.ts", "vite.config.ts"],
      }),
    ],
    [
      "vite.config.ts",
      `import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        setup: workspaceRoot + "setup/index.html",
        play: workspaceRoot + "play/index.html",
      },
    },
  },
  server: { host: "127.0.0.1", cors: true },
});
`,
    ],
    [
      "README.md",
      `# ${gameId} Surface 草稿

> 非发布型占位页，没有玩法、房间连接或可提交的操作。

此包使用 TypeScript/Vite，预留 Bridge V2 接入。它只依赖 Bridge，不导入 Core、Client Host、Protocol 或数据库。

运行 pnpm --filter @online-game-hub/${gameId}-surface dev 后访问 /setup/ 或 /play/。build/typecheck 可独立运行；surfaceArtifact: false 使仓库发布工具明确排除此草稿。

规则与接入步骤见[游戏草稿](../../games/${gameId}/README.md)。正式接入前必须实现 Bridge V2、严格的投影解析和最小 intent，补齐 test/contract-test，再定义制品配置并生成锁；当前不生成制品 manifest 或摘要锁。
`,
    ],
    [
      "tests/README.md",
      "# Surface 测试待实现\n\n实现画面后添加 projected View、最小 intent、只读/终局、Bridge V2、可访问交互与 viewport 测试，并补齐 test/contract-test 命令。草稿检查不能替代正式制品验证。\n",
    ],
  ]);
  for (const [mode, label] of [
    ["setup", "设置"],
    ["play", "对局"],
  ] as const) {
    files.set(
      `${mode}/index.html`,
      `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${gameId} · ${label}草稿</title>
  </head>
  <body>
    <main>
      <h1>${label}画面尚未实现</h1>
      <p>这是 ${gameId} 的本地开发占位页，尚未接入房间或游戏操作。</p>
    </main>
    <script type="module" src="../src/${mode}.ts"></script>
  </body>
</html>
`,
    );
    files.set(
      `src/${mode}.ts`,
      "// TODO: Consume projected views and submit intents through Bridge V2.\nexport {};\n",
    );
  }
  return files;
}

export function generatedPackages(gameId: string): readonly GeneratedPackage[] {
  return [
    {
      relativeDirectory: `games/${gameId}`,
      packageName: `@online-game-hub/${gameId}`,
      files: gameFiles(gameId),
    },
    {
      relativeDirectory: `game-surfaces/${gameId}`,
      packageName: `@online-game-hub/${gameId}-surface`,
      files: surfaceFiles(gameId),
    },
  ];
}
