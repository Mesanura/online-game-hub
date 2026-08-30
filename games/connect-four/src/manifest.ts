import { defineGameId, defineGameVersion } from "@online-game-hub/game-sdk";
import type { GameManifest } from "@online-game-hub/game-sdk";

export const connectFourManifest = Object.freeze({
  id: defineGameId("connect-four"),
  gameVersion: defineGameVersion("1.0.0"),
  title: "Connect Four",
  description: "两名玩家轮流选择列落子，率先在任一方向连成四子者获胜。",
  minPlayers: 2,
  maxPlayers: 2,
  runtime: "turn-based",
  capabilities: Object.freeze({
    hiddenInformation: false,
    deterministicRandomness: false,
  }),
}) satisfies GameManifest;
