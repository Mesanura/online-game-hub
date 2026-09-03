import {
  defineRealtimeGameId,
  defineRealtimeGameVersion,
} from "@online-game-hub/realtime-game-sdk";
import type { RealtimeGameManifest } from "@online-game-hub/realtime-game-sdk";

import { PONG_TICK_RATE } from "./constants.js";

export const pongManifest = Object.freeze({
  runtime: "realtime",
  id: defineRealtimeGameId("pong"),
  gameVersion: defineRealtimeGameVersion("1.0.0"),
  title: "乒乓对战",
  description: "两名玩家实时控制球拍，率先达到目标分数者获胜。",
  defaultConfig: Object.freeze({ targetScore: 3 }),
  minPlayers: 2,
  maxPlayers: 2,
  tickRate: PONG_TICK_RATE,
  capabilities: Object.freeze({
    hiddenInformation: false,
    deterministicRandomness: true,
  }),
}) satisfies RealtimeGameManifest;
