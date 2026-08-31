import { defineGameId, defineGameVersion } from "@online-game-hub/game-sdk";
import type { GameManifest } from "@online-game-hub/game-sdk";

export const ticTacToeManifest = Object.freeze({
  id: defineGameId("tic-tac-toe"),
  gameVersion: defineGameVersion("1.0.0"),
  title: "井字棋",
  description: "两名玩家轮流在 3×3 棋盘落子，率先连成一线者获胜。",
  defaultConfig: null,
  minPlayers: 2,
  maxPlayers: 2,
  runtime: "turn-based",
  capabilities: Object.freeze({
    hiddenInformation: false,
    deterministicRandomness: false,
  }),
}) satisfies GameManifest;
