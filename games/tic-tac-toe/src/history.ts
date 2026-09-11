import { z } from "zod";

const slot = z.string().min(1);
const outcomeSchema = z.union([
  z
    .object({
      type: z.literal("WIN"),
      winnerSlotId: slot,
      winningCells: z.array(z.number().int().min(0).max(8)).length(3),
    })
    .strict(),
  z
    .object({
      type: z.literal("WIN"),
      reason: z.literal("RESIGNATION"),
      winnerSlotId: slot,
      resignedSlotId: slot,
    })
    .strict(),
  z.object({ type: z.literal("DRAW") }).strict(),
]);

const gameVersions: readonly string[] = ["1.0.0", "1.1.0"];

/** A pure, viewer-specific projection of archived results; never exposes Outcome. */
export const ticTacToeHistory = {
  gameId: "tic-tac-toe",
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
      players.length !== 2 ||
      players.some((slot) => typeof slot !== "string" || slot.length === 0) ||
      new Set(players).size !== players.length ||
      !players.includes(playerSlotId)
    )
      return null;
    const parsed = outcomeSchema.safeParse(recordedOutcome);
    if (!parsed.success) return null;
    const outcome = parsed.data;
    if (outcome.type === "WIN" && !players.includes(outcome.winnerSlotId))
      return null;
    if (
      "resignedSlotId" in outcome &&
      (!players.includes(outcome.resignedSlotId) ||
        outcome.resignedSlotId === outcome.winnerSlotId)
    )
      return null;
    if (gameVersion === "1.0.0" && "reason" in outcome) return null;
    if (outcome.type === "DRAW")
      return { kind: "win-loss" as const, value: "draw" as const };
    return {
      kind: "win-loss" as const,
      value:
        outcome.winnerSlotId === playerSlotId
          ? ("win" as const)
          : ("loss" as const),
    };
  },
};
