import { outcomeSchema } from "./contracts.js";

export const bombermanHistory = {
  gameId: "bomberman",
  gameVersions: ["1.0.0"] as readonly string[],
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
      gameVersion !== "1.0.0" ||
      players.length < 2 ||
      players.length > 4 ||
      new Set(players).size !== players.length ||
      players.some((slot) => typeof slot !== "string" || slot.length === 0) ||
      !players.includes(playerSlotId)
    )
      return null;
    const result = outcomeSchema.safeParse(recordedOutcome);
    if (!result.success) return null;
    const outcome = result.data;
    if (
      outcome.scores.length !== players.length ||
      new Set(outcome.scores.map((score) => score.slotId)).size !==
        players.length ||
      outcome.scores.some((score) => !players.includes(score.slotId))
    )
      return null;
    if (outcome.type === "DRAW")
      return outcome.winnerSlotId === null &&
        outcome.reason === "RESIGNATION" &&
        outcome.scores.every((score) => score.score < 3)
        ? { kind: "win-loss" as const, value: "draw" as const }
        : null;
    if (
      outcome.winnerSlotId === null ||
      !players.includes(outcome.winnerSlotId)
    )
      return null;
    if (
      outcome.reason === "SCORE" &&
      outcome.scores.some((score) =>
        score.slotId === outcome.winnerSlotId
          ? score.score !== 3
          : score.score >= 3,
      )
    )
      return null;
    if (
      outcome.reason === "RESIGNATION" &&
      outcome.scores.some((score) => score.score >= 3)
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
