import { hexOutcomeSchema as outcomeSchema } from "./core/index.js";

const gameVersions: readonly string[] = ["1.0.0"];

/** A pure, viewer-specific projection of archived results; never exposes Outcome. */
export const hexHistory = {
  gameId: "hex",
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
    return {
      kind: "win-loss" as const,
      value:
        outcome.winnerSlotId === playerSlotId
          ? ("win" as const)
          : ("loss" as const),
    };
  },
};
