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
    reason: z.enum(["SURVIVOR", "ALL_ELIMINATED", "TIMEOUT", "RESIGNATION"]),
    standings: z
      .array(
        z
          .object({
            slotId: z.string().min(1),
            lives: z.number().int().min(0).max(3),
            resigned: z.boolean(),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict()
  .superRefine((outcome, context) => {
    const survivors = outcome.standings.filter((entry) => entry.lives > 0);
    const invalid =
      new Set(outcome.standings.map((entry) => entry.slotId)).size !==
        outcome.standings.length ||
      outcome.standings.some((entry) => entry.resigned && entry.lives !== 0) ||
      (outcome.type === "WIN"
        ? survivors.length !== 1 ||
          survivors[0]?.slotId !== outcome.winnerSlotId ||
          !["SURVIVOR", "RESIGNATION"].includes(outcome.reason)
        : outcome.winnerSlotId !== null ||
          (outcome.reason === "TIMEOUT"
            ? survivors.length < 2
            : !["ALL_ELIMINATED", "RESIGNATION"].includes(outcome.reason) ||
              survivors.length !== 0));
    if (invalid)
      context.addIssue({
        code: "custom",
        message: "Inconsistent match result.",
      });
  });
export type Config = z.infer<typeof configSchema>;
export type Input = z.infer<typeof inputSchema>;
export type Outcome = z.infer<typeof outcomeSchema>;
export type Direction = Extract<Input, { type: "MOVE" }>["direction"];
