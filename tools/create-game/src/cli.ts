#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import { createGame, CreateGameError } from "./index.ts";
import type { CreateGameResult } from "./index.ts";

export const HELP_TEXT = `用法：pnpm create-game --game-id <lowercase-kebab-case>

从 online-game-hub workspace root 创建回合制 V6 Setup / Bridge V2 开发草稿：games/<id>、game-surfaces/<id> 及两个 pnpm lockfile importer。草稿可独立构建，不进入游戏目录或 Surface 发布制品。

选项：
  --game-id <id>  必填；稳定 lowercase kebab-case 游戏标识
  --help           显示帮助并退出

退出码：
  0  创建成功、幂等无变更或显示帮助
  1  写入或固定 pnpm lockfile 更新失败（已尝试回滚）
  2  参数、gameId、workspace 或冲突 preflight 失败（零写入）

示例：
  pnpm create-game --game-id example-game
`;

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export interface CliRuntime {
  readonly workspaceRoot: () => string;
  readonly createGame: (options: {
    readonly workspaceRoot: string;
    readonly gameId: string;
  }) => Promise<CreateGameResult>;
}

interface ParsedArguments {
  readonly help: boolean;
  readonly gameId?: string;
}

function argumentError(message: string): never {
  throw new CreateGameError("INVALID_ARGUMENTS", message, 2);
}

export function parseArguments(args: readonly string[]): ParsedArguments {
  if (args.includes("--help")) return { help: true };

  let gameId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--game-id") {
      argumentError(`未知参数 ${JSON.stringify(argument)}。`);
    }
    if (gameId !== undefined) {
      argumentError("--game-id 只能提供一次。");
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      argumentError("--game-id 缺少值。");
    }
    gameId = value;
    index += 1;
  }

  if (gameId === undefined) {
    argumentError("缺少必填参数 --game-id <id>。");
  }
  return { help: false, gameId };
}

const FOLLOW_UP_CHECKLIST = [
  "完善 GAME_SPEC.md，确认名称、规则、人数、版本与 replay 能力，再实现 manifest、纯 Core 和 V6 Setup。",
  "通过 Bridge V2 实现独立 Setup/Play 的严格投影解析、最小 intent 与可访问交互；player-playback 还需 Replay 入口。",
  "补齐真实 unit、Setup、golden、Surface contract、integration 与 PostgreSQL-backed 浏览器测试，并添加相应测试命令。",
  "定义 surface.config.json 的版本、入口与能力，将 onlineGameHub.surfaceArtifact 改为 true，补齐 artifact:lock、finalize build 和制品验证脚本，生成并审查 surface.lock.json。",
  "显式登记 registry dependencies、catalog、exact Core/Setup resolver 和 deployment Surface 映射；按实际导入需要调整 Next transpilePackages。",
  "在 Dockerfile 的依赖安装阶段补充两个包的 package.json COPY，并验证生产构建与不可变制品发布。",
  "按 docs/TESTING.md 完成检查与 Plugin Definition of Done 后，再提交正式接入。",
] as const;

export function formatSuccess(result: CreateGameResult): string {
  const summary =
    result.status === "created"
      ? `已创建 ${result.packageName} 与 ${result.surfacePackageName} 的未发布开发草稿。`
      : `${result.packageName} 与 ${result.surfacePackageName} 草稿完整；本次幂等运行没有写入。`;
  const changed =
    result.changedFiles.length === 0
      ? "变更文件：无。"
      : `变更文件（稳定排序）：\n${result.changedFiles.map((file) => `- ${file}`).join("\n")}`;
  const checklist = FOLLOW_UP_CHECKLIST.map(
    (item, index) => `${String(index + 1)}. ${item}`,
  ).join("\n");
  return `${summary}\n游戏目录：${result.gameDirectory}\nSurface 目录：${result.surfaceDirectory}\n${changed}\n\n正式接入清单（详见生成的 README.md）：\n${checklist}\n`;
}

const processIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

const processRuntime: CliRuntime = {
  workspaceRoot: () => process.cwd(),
  createGame,
};

export async function runCli(
  args: readonly string[],
  io: CliIo = processIo,
  runtime: CliRuntime = processRuntime,
): Promise<number> {
  try {
    const parsed = parseArguments(args);
    if (parsed.help) {
      io.stdout(HELP_TEXT);
      return 0;
    }
    if (parsed.gameId === undefined) {
      argumentError("缺少必填参数 --game-id <id>。");
    }
    const result = await runtime.createGame({
      workspaceRoot: runtime.workspaceRoot(),
      gameId: parsed.gameId,
    });
    io.stdout(formatSuccess(result));
    return 0;
  } catch (error) {
    if (error instanceof CreateGameError) {
      io.stderr(`错误 [${error.code}]：${error.message}\n`);
      if (error.exitCode === 2) {
        io.stderr("运行 pnpm create-game --help 查看稳定参数契约。\n");
      } else {
        io.stderr(
          "请检查 git diff；若仍有本轮残留，只检查本次 games/<id>、game-surfaces/<id> 与 pnpm-lock.yaml。\n",
        );
      }
      return error.exitCode;
    }
    io.stderr(
      `错误 [UNEXPECTED]：${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(entryPath)).href
) {
  process.exitCode = await runCli(process.argv.slice(2));
}
