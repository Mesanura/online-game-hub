import { z } from "zod";
import {
  classicMap,
  classicMode,
  supportedPlayerCounts,
} from "./definitions.js";

export const configSchema = z
  .object({
    mapId: z.literal("classic-arena"),
    modeId: z.literal("classic"),
    playerCount: z.number().int().safe(),
  })
  .strict()
  .refine(
    (config) =>
      supportedPlayerCounts(classicMap, classicMode).includes(
        config.playerCount,
      ),
    "Unsupported map and mode capacity",
  );
export const inputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("MOVE"),
      direction: z.enum(["up", "right", "down", "left", "none"]),
    })
    .strict(),
  z.object({ type: z.literal("PLACE_BOMB") }).strict(),
  z.object({ type: z.literal("RESIGN") }).strict(),
]);
export const outcomeSchema = z
  .object({
    type: z.enum(["WIN", "DRAW"]),
    winnerSlotId: z.string().min(1).nullable(),
    reason: z.enum(["SCORE", "RESIGNATION"]),
    scores: z
      .array(
        z
          .object({
            slotId: z.string().min(1),
            score: z.number().int().min(0).max(3),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;
export type Input = z.infer<typeof inputSchema>;
export type Outcome = z.infer<typeof outcomeSchema>;
export type Direction = Extract<Input, { type: "MOVE" }>["direction"];
