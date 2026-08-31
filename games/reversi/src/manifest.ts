import { defineGameId, defineGameVersion } from "@online-game-hub/game-sdk";
import type { GameManifest } from "@online-game-hub/game-sdk";

export const reversiManifest = Object.freeze({
  id: defineGameId("reversi"),
  gameVersion: defineGameVersion("1.0.0"),
  title: "黑白棋",
  description: "两名玩家轮流落子并翻转夹住的对方棋子，终局时棋子更多者获胜。",
  defaultConfig: null,
  minPlayers: 2,
  maxPlayers: 2,
  runtime: "turn-based",
  capabilities: Object.freeze({
    hiddenInformation: false,
    deterministicRandomness: false,
  }),
}) satisfies GameManifest;
