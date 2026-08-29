import { randomBytes, randomUUID } from "node:crypto";

import { definePlayerSlotId } from "@online-game-hub/game-sdk";
import type { PlayerSlotId } from "@online-game-hub/game-sdk";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface RuntimeIdSource {
  createRoomCode(): string;
  createReplayId(): string;
  createRngSeed(): string;
  createPlayerSlotId(index: number): PlayerSlotId;
}

export const secureRuntimeIdSource: RuntimeIdSource = {
  createRoomCode() {
    const bytes = randomBytes(8);
    return [...bytes].map((byte) => ROOM_CODE_ALPHABET[byte & 31]).join("");
  },
  createReplayId: () => randomUUID(),
  createRngSeed: () => randomBytes(32).toString("base64url"),
  createPlayerSlotId: (index) =>
    definePlayerSlotId(
      `slot-${index + 1}-${randomBytes(6).toString("base64url")}`,
    ),
};
