import {
  defineRealtimeGameId,
  defineRealtimeGameVersion,
  type RealtimeGameManifest,
} from "@online-game-hub/realtime-game-sdk";
export const ninjaClashManifest = Object.freeze({
  runtime: "realtime",
  id: defineRealtimeGameId("ninja-clash"),
  gameVersion: defineRealtimeGameVersion("1.0.0"),
  title: "像素忍战",
  description:
    "蹬墙跃起、滑行闪避、刀锋相抵，2–4 人一击决胜，留到最后抢下积分。",
  defaultConfig: { playerCount: 2, targetScore: 5 },
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
