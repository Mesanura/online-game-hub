import {
  defineRealtimeGameId,
  defineRealtimeGameVersion,
  type RealtimeGameManifest,
} from "@online-game-hub/realtime-game-sdk";

export const airHockeyManifest = Object.freeze({
  runtime: "realtime",
  id: defineRealtimeGameId("air-hockey"),
  gameVersion: defineRealtimeGameVersion("1.0.0"),
  title: "气垫球",
  description: "移动球拍，掌握击球速度，将球打入对方球门。",
  defaultConfig: Object.freeze({ targetScore: 7 }),
  minPlayers: 2,
  maxPlayers: 2,
  tickRate: 60,
  inputDelivery: "latest",
  capabilities: Object.freeze({
    hiddenInformation: false,
    deterministicRandomness: true,
    replay: "record-only",
  }),
}) satisfies RealtimeGameManifest;
