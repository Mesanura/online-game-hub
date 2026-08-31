import { defineGameId, defineGameVersion } from "@online-game-hub/game-sdk";
import type { GameManifest } from "@online-game-hub/game-sdk";

export const hexManifest = Object.freeze({
  id: defineGameId("hex"),
  gameVersion: defineGameVersion("1.0.0"),
  title: "六贯棋",
  description:
    "两名玩家轮流在六边形格落子，率先用己方棋子连接对应两条边者获胜。",
  defaultConfig: null,
  minPlayers: 2,
  maxPlayers: 2,
  runtime: "turn-based",
  capabilities: Object.freeze({
    hiddenInformation: false,
    deterministicRandomness: false,
  }),
}) satisfies GameManifest;
