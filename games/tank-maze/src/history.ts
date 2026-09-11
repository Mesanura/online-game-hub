import { z } from "zod";

const outcomeSchema = z
  .object({
    type: z.enum(["WIN", "DRAW"]),
    winnerSlotId: z.string().min(1).nullable(),
    reason: z.enum(["SCORE", "RESIGNATION"]),
    scores: z
      .array(
        z
          .object({
            slotId: z.string().min(1),
            score: z.number().int().min(0).max(20),
          })
          .strict(),
      )
      .min(2)
      .max(8),
  })
  .strict();

const gameVersions: readonly string[] = ["1.0.0", "1.1.0"];

/** A pure, viewer-specific projection of archived results; never exposes Outcome. */
export const tankMazeHistory = {
  gameId: "tank-maze",
  gameVersions,
  projectView({
    gameVersion,
    recordedOutcome,
    players,
    playerSlotId,
  }: {
    readonly gameVersion: string;
    readonly recordedOutcome: unknown;
    readonly players: readonly string[];
    readonly playerSlotId: string;
  }) {
    if (
      !gameVersions.includes(gameVersion) ||
      players.length < 2 ||
      players.length > 8 ||
      players.some((slot) => typeof slot !== "string" || slot.length === 0) ||
      new Set(players).size !== players.length ||
      !players.includes(playerSlotId)
    )
      return null;
    const parsed = outcomeSchema.safeParse(recordedOutcome);
    if (!parsed.success) return null;
    const outcome = parsed.data;
    const scores = outcome.scores;
    if (
      scores.length !== players.length ||
      new Set(scores.map((entry) => entry.slotId)).size !== players.length ||
      scores.some((entry) => !players.includes(entry.slotId)) ||
      (outcome.type === "WIN"
        ? outcome.winnerSlotId === null ||
          !players.includes(outcome.winnerSlotId)
        : outcome.winnerSlotId !== null)
    )
      return null;
    const own = scores.find((entry) => entry.slotId === playerSlotId);
    if (own === undefined) return null;
    return {
      kind: "rank" as const,
      rank: 1 + scores.filter((entry) => entry.score > own.score).length,
      tied: scores.filter((entry) => entry.score === own.score).length > 1,
    };
  },
};
