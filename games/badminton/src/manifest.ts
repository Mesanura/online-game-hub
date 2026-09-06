import {
  defineRealtimeGameId,
  defineRealtimeGameVersion,
  type RealtimeGameManifest,
} from "@online-game-hub/realtime-game-sdk";

export const badmintonManifest = Object.freeze({
  runtime: "realtime",
  id: defineRealtimeGameId("badminton"),
  gameVersion: defineRealtimeGameVersion("1.0.0"),
  title: "火柴人羽毛球",
  description: "跑动、起跳、高远球与扣杀，和朋友来一场轻快的隔网对决。",
  defaultConfig: Object.freeze({ targetScore: 7 }),
  minPlayers: 2,
  maxPlayers: 2,
  tickRate: 60,
  capabilities: Object.freeze({
    hiddenInformation: false,
    deterministicRandomness: true,
    replay: "record-only",
  }),
}) satisfies RealtimeGameManifest;
