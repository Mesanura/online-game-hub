import { defineGameId, defineGameVersion } from "@online-game-hub/game-sdk";
import type { GameManifest } from "@online-game-hub/game-sdk";

export const chineseCheckersManifest = Object.freeze({
  id: defineGameId("chinese-checkers"),
  gameVersion: defineGameVersion("1.0.0"),
  title: "中国跳棋",
  description: "2 至 6 名玩家各占六子，率先完成对角营地并争取更高排名。",
  defaultConfig: null,
  minPlayers: 2,
  maxPlayers: 6,
  runtime: "turn-based",
  capabilities: Object.freeze({
    hiddenInformation: false,
    deterministicRandomness: false,
    replay: "player-playback",
    playerAssignment: Object.freeze({
      kind: "camp",
      options: Object.freeze(["N", "NW", "SW", "S", "SE", "NE"]),
    }),
  }),
}) satisfies GameManifest;
