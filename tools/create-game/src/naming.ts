import path from "node:path";

import { CreateGameError } from "./errors.ts";

const GAME_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const RESERVED_GAME_IDS = new Set([
  "_next",
  "admin",
  "api",
  "apps",
  "client",
  "core",
  "dist",
  "favicon",
  "games",
  "manifest",
  "node_modules",
  "packages",
  "public",
  "registry",
  "server",
  "src",
  "tests",
  "tooling",
  "tools",
]);

const WINDOWS_RESERVED_NAME_PATTERN =
  /^(?:aux|clock\$|con|nul|prn|com[1-9]|lpt[1-9])$/;

export interface GameSymbols {
  readonly base: string;
  readonly pascal: string;
  readonly manifest: string;
  readonly definition: string;
  readonly clientModule: string;
  readonly clientLoader: string;
}

export function validateGameId(gameId: string): void {
  if (
    gameId.length === 0 ||
    path.posix.isAbsolute(gameId) ||
    path.win32.isAbsolute(gameId) ||
    gameId.includes("/") ||
    gameId.includes("\\") ||
    gameId === "." ||
    gameId === ".."
  ) {
    throw new CreateGameError(
      "INVALID_GAME_ID",
      "gameId 必须是非空 lowercase kebab-case，且不能是路径。",
      2,
    );
  }

  if (!GAME_ID_PATTERN.test(gameId)) {
    throw new CreateGameError(
      "INVALID_GAME_ID",
      `无效 gameId ${JSON.stringify(gameId)}；仅接受以小写字母开头、由小写字母/数字及单个连字符分段组成的 kebab-case。`,
      2,
    );
  }

  if (
    RESERVED_GAME_IDS.has(gameId) ||
    WINDOWS_RESERVED_NAME_PATTERN.test(gameId)
  ) {
    throw new CreateGameError(
      "INVALID_GAME_ID",
      `gameId ${JSON.stringify(gameId)} 是保留名称。`,
      2,
    );
  }
}

function upperFirst(segment: string): string {
  const first = segment[0];
  if (first === undefined) {
    throw new CreateGameError("INVALID_GAME_ID", "gameId 不能包含空段。", 2);
  }
  return `${first.toUpperCase()}${segment.slice(1)}`;
}

export function deriveGameSymbols(gameId: string): GameSymbols {
  validateGameId(gameId);
  const [firstSegment, ...remainingSegments] = gameId.split("-");
  if (firstSegment === undefined) {
    throw new CreateGameError(
      "INVALID_GAME_ID",
      "gameId 必须至少包含一个符号段。",
      2,
    );
  }

  const base = `${firstSegment}${remainingSegments.map(upperFirst).join("")}`;
  const pascal = upperFirst(base);
  return Object.freeze({
    base,
    pascal,
    manifest: `${base}Manifest`,
    definition: `${base}Definition`,
    clientModule: `${base}ClientModule`,
    clientLoader: `load${pascal}Entrypoint`,
  });
}
