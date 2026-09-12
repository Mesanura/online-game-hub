import { airHockeyOutcomeSchema } from "./core/schemas.js";

export const airHockeyHistory = {
  gameId: "air-hockey",
  gameVersions: ["1.0.0"],
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
    const index = players.indexOf(playerSlotId);
    if (
      gameVersion !== "1.0.0" ||
      players.length !== 2 ||
      new Set(players).size !== 2 ||
      index < 0
    )
      return null;
    const parsed = airHockeyOutcomeSchema.safeParse(recordedOutcome);
    if (!parsed.success || !players.includes(parsed.data.winnerSlotId))
      return null;
    const outcome = parsed.data;
    if (
      outcome.reason === "RESIGNATION" &&
      (!players.includes(outcome.resignedSlotId) ||
        outcome.resignedSlotId === outcome.winnerSlotId)
    )
      return null;
    return {
      kind: "score" as const,
      own: outcome.scores[index === 0 ? 0 : 1],
      opponent: outcome.scores[index === 0 ? 1 : 0],
    };
  },
};
