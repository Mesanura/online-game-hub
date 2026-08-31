#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import { createGame, CreateGameError } from "./index.ts";
import type { CreateGameResult } from "./index.ts";

export const HELP_TEXT = `用法：pnpm create-game --game-id <lowercase-kebab-case>

从 online-game-hub workspace root 创建一个未完成的游戏 package 机械骨架，并完成显式 registry、Next transpile 与 pnpm lockfile 登记。

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
  "由产品/游戏负责人提供 manifest：正式中文 title、description、canonical defaultConfig、玩家数与 capabilities。",
  "编写纯 TypeScript Core：Config/Action/State/View/Outcome、strict schemas、deterministic transition 与 projectView。",
  "编写 Client Module；客户端只提交 intent，不导入 Core 或伪造 authoritative State/Outcome。",
  "补充 GAME_SPEC.md 与局部 AGENTS.md，明确规则、版本和不变量。",
  "设计该游戏自己的 CSS/可访问交互；生成器不会制作视觉模板。",
  "补齐 Core unit、Client component 与 registry contract tests。",
  "人工制作并审查 1.0.0（或产品确认版本）的 canonical golden replay。",
  "设计真实 authoritative integration 与 PostgreSQL-backed Playwright E2E 对局序列。",
  "运行 package test/typecheck/build，再运行 pnpm lint、pnpm typecheck、pnpm test、pnpm build、pnpm deps:check；按实际边界补跑 integration/database/E2E。",
] as const;

export function formatSuccess(result: CreateGameResult): string {
  const summary =
    result.status === "created"
      ? `已创建 ${result.packageName} 的机械骨架并完成显式登记。`
      : `${result.packageName} 已完整登记；本次幂等运行没有写入。`;
  const changed =
    result.changedFiles.length === 0
      ? "变更文件：无。"
      : `变更文件（稳定排序）：\n${result.changedFiles.map((file) => `- ${file}`).join("\n")}`;
  const checklist = FOLLOW_UP_CHECKLIST.map(
    (item, index) => `${String(index + 1)}. ${item}`,
  ).join("\n");
  return `${summary}\n目录：${result.gameDirectory}\n${changed}\n\n人工后续清单（完成前不满足 Plugin Definition of Done）：\n${checklist}\n\n本生成器不修改 Protocol V2、Replay Format V1、database schema、现有 gameVersion 或平台 public runtime API。\n`;
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
          "请检查 git diff；若仍有本轮残留，只恢复错误消息列出的生成目录、登记文件和 pnpm-lock.yaml。\n",
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
