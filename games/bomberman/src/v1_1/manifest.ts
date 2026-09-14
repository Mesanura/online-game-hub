import {
  defineRealtimeGameId,
  defineRealtimeGameVersion,
  type RealtimeGameManifest,
} from "@online-game-hub/realtime-game-sdk";

export const bombermanManifest = Object.freeze({
  runtime: "realtime",
  id: defineRealtimeGameId("bomberman"),
  gameVersion: defineRealtimeGameVersion("1.1.0"),
  title: "像素炸弹人",
  description: "炸开砖块、收集道具、引爆连锁，2–4 人每人三条命，留到最后获胜。",
  defaultConfig: { mapId: "classic-arena", modeId: "classic", playerCount: 2 },
  minPlayers: 2,
  maxPlayers: 4,
  tickRate: 60,
  inputDelivery: "events",
  capabilities: {
    hiddenInformation: false,
    deterministicRandomness: true,
    replay: "record-only",
  },
} as const) satisfies RealtimeGameManifest;
