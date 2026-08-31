import { defineGameId, defineGameVersion } from "@online-game-hub/game-sdk";
import type { GameManifest } from "@online-game-hub/game-sdk";

import { GOMOKU_DEFAULT_BOARD_SIZE, GOMOKU_WIN_LENGTH } from "./constants.js";
import type { GomokuConfig } from "./types.js";

export const gomokuDefaultConfig = Object.freeze({
  boardSize: GOMOKU_DEFAULT_BOARD_SIZE,
  winLength: GOMOKU_WIN_LENGTH,
}) satisfies GomokuConfig;

export const gomokuManifest = Object.freeze({
  id: defineGameId("gomoku"),
  gameVersion: defineGameVersion("1.0.0"),
  title: "五子棋",
  description: "两名玩家轮流落子，率先在横、竖或斜线连成五子者获胜。",
  defaultConfig: gomokuDefaultConfig,
  minPlayers: 2,
  maxPlayers: 2,
  runtime: "turn-based",
  capabilities: Object.freeze({
    hiddenInformation: false,
    deterministicRandomness: false,
  }),
}) satisfies GameManifest;
