import {
  defineRealtimeGameId,
  defineRealtimeGameVersion,
  type RealtimeGameManifest,
} from "@online-game-hub/realtime-game-sdk";
export const tankMazeManifestV1_0_0 = Object.freeze({
  runtime: "realtime",
  id: defineRealtimeGameId("tank-maze"),
  gameVersion: defineRealtimeGameVersion("1.0.0"),
  title: "坦克迷战",
  description:
    "反弹炮弹、随机迷宫与五种道具，和 2–8 位朋友一起争夺最后的幸存者。",
  defaultConfig: { playerCount: 2, targetScore: 10, colors: [] },
  minPlayers: 2,
  maxPlayers: 8,
  tickRate: 60,
  inputDelivery: "events",
  capabilities: {
    hiddenInformation: false,
    deterministicRandomness: true,
    replay: "record-only",
  },
} as const) satisfies RealtimeGameManifest;

export const tankMazeManifestV1_1_0 = Object.freeze({
  ...tankMazeManifestV1_0_0,
  gameVersion: defineRealtimeGameVersion("1.1.0"),
}) satisfies RealtimeGameManifest;

export const tankMazeManifest = Object.freeze({
  ...tankMazeManifestV1_1_0,
  gameVersion: defineRealtimeGameVersion("1.2.0"),
}) satisfies RealtimeGameManifest;
