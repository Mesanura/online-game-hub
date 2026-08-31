import type { GameSymbols } from "./naming.ts";

export const GENERATED_DIRECTORIES = Object.freeze([
  "src",
  "src/client",
  "src/core",
  "tests",
  "tests/fixtures",
]);

export interface TextRegistration {
  readonly relativePath: string;
  readonly anchor: string;
  readonly snippet: string;
  readonly collisionTokens: readonly string[];
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function generatedFiles(gameId: string): ReadonlyMap<string, string> {
  const packageName = `@online-game-hub/${gameId}`;
  return new Map([
    [
      "package.json",
      json({
        name: packageName,
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
          "./client": {
            types: "./dist/client/index.d.ts",
            import: "./dist/client/index.js",
          },
        },
        scripts: {
          build: "tsc -p tsconfig.build.json",
          test: "vitest run",
          "test:golden": "vitest run tests/golden-replay.test.ts",
          typecheck: "tsc -p tsconfig.json && tsc -p tests/tsconfig.json",
        },
        dependencies: {
          "@online-game-hub/game-client-sdk": "workspace:*",
          "@online-game-hub/game-sdk": "workspace:*",
          zod: "4.4.3",
        },
        devDependencies: {
          "@online-game-hub/game-server-runtime": "workspace:*",
          "@types/react": "19.2.18",
          "@types/react-dom": "19.2.5",
          react: "19.2.8",
          "react-dom": "19.2.8",
        },
        peerDependencies: {
          react: "19.2.8",
        },
      }),
    ],
    [
      "tsconfig.json",
      json({
        extends: "../../tsconfig.base.json",
        compilerOptions: {
          jsx: "react-jsx",
          lib: ["ES2023", "DOM", "DOM.Iterable"],
          rootDir: "src",
        },
        include: ["src/**/*.ts", "src/**/*.tsx"],
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
        include: ["src/**/*.ts", "src/**/*.tsx"],
        exclude: ["tests/**/*.ts", "tests/**/*.tsx"],
      }),
    ],
    [
      "tests/tsconfig.json",
      json({
        extends: "../tsconfig.json",
        compilerOptions: {
          rootDir: "..",
          types: ["node"],
        },
        include: [
          "../src/**/*.ts",
          "../src/**/*.tsx",
          "./**/*.ts",
          "./**/*.tsx",
        ],
      }),
    ],
    [
      "README.md",
      `# ${gameId}\n\n> 由 \`tools/create-game\` 创建的未完成机械骨架。\n\n此 package 尚未实现 manifest、规则 Core 或 Client Module，也尚未达到 Game Plugin Definition of Done。请由游戏负责人定义产品语义，并完成 CLI 成功输出中的人工后续清单。\n`,
    ],
  ]);
}

function clientLoaderSnippet(
  packageName: string,
  symbols: GameSymbols,
): string {
  const singleLine = `const ${symbols.clientLoader} = () => import("${packageName}/client");`;
  return singleLine.length <= 80
    ? singleLine
    : `const ${symbols.clientLoader} = () =>\n  import("${packageName}/client");`;
}

function clientRegistrationSnippet(symbols: GameSymbols): string {
  const compactErase = `      eraseGameClientModule((await ${symbols.clientLoader}()).${symbols.clientModule}),`;
  const erase =
    compactErase.length <= 80
      ? compactErase
      : [
          "      eraseGameClientModule(",
          `        (await ${symbols.clientLoader}()).${symbols.clientModule},`,
          "      ),",
        ].join("\n");

  return [
    "  {",
    `    gameId: ${symbols.manifest}.id,`,
    `    gameVersion: ${symbols.manifest}.gameVersion,`,
    `    loadEntrypoint: ${symbols.clientLoader},`,
    "    loadModule: async (): Promise<UnknownGameClientModule> =>",
    erase,
    "  },",
  ].join("\n");
}

export function textRegistrations(
  gameId: string,
  symbols: GameSymbols,
): readonly TextRegistration[] {
  const packageName = `@online-game-hub/${gameId}`;
  return Object.freeze([
    {
      relativePath: "packages/game-registry/src/catalog.ts",
      anchor: "// create-game:catalog-import",
      snippet: `import { ${symbols.manifest} } from "${packageName}/manifest";`,
      collisionTokens: [packageName, symbols.manifest],
    },
    {
      relativePath: "packages/game-registry/src/catalog.ts",
      anchor: "  // create-game:catalog-entry",
      snippet: `  ${symbols.manifest},`,
      collisionTokens: [symbols.manifest],
    },
    {
      relativePath: "packages/game-registry/src/client.ts",
      anchor: "// create-game:client-manifest-import",
      snippet: `import { ${symbols.manifest} } from "${packageName}/manifest";`,
      collisionTokens: [packageName, symbols.manifest],
    },
    {
      relativePath: "packages/game-registry/src/client.ts",
      anchor: "// create-game:client-loader",
      snippet: clientLoaderSnippet(packageName, symbols),
      collisionTokens: [packageName, symbols.clientLoader],
    },
    {
      relativePath: "packages/game-registry/src/client.ts",
      anchor: "  // create-game:client-registration",
      snippet: clientRegistrationSnippet(symbols),
      collisionTokens: [
        symbols.manifest,
        symbols.clientLoader,
        symbols.clientModule,
      ],
    },
    {
      relativePath: "packages/game-registry/src/server.ts",
      anchor: "// create-game:server-definition-import",
      snippet: `import { ${symbols.definition} } from "${packageName}/core";`,
      collisionTokens: [packageName, symbols.definition],
    },
    {
      relativePath: "packages/game-registry/src/server.ts",
      anchor: "  // create-game:server-definition",
      snippet: `  eraseGameDefinition(${symbols.definition}),`,
      collisionTokens: [symbols.definition],
    },
    {
      relativePath: "apps/web/next.config.ts",
      anchor: "    // create-game:transpile-package",
      snippet: `    "${packageName}",`,
      collisionTokens: [packageName],
    },
  ]);
}
