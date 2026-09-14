import { outcomeSchema } from "./contracts.js";
import { bombermanHistory as legacyHistory } from "../v1/history.js";

export const bombermanHistory = {
  gameId: "bomberman",
  gameVersions: ["1.0.0", "1.1.0"] as readonly string[],
  projectView(context: {
    readonly gameVersion: string;
    readonly recordedOutcome: unknown;
    readonly players: readonly string[];
    readonly playerSlotId: string;
  }) {
    if (context.gameVersion === "1.0.0")
      return legacyHistory.projectView(context);
    const { gameVersion, recordedOutcome, players, playerSlotId } = context;
    if (
      gameVersion !== "1.1.0" ||
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
      outcome.standings.length !== players.length ||
      outcome.standings.some((entry) => !players.includes(entry.slotId))
    )
      return null;
    return {
      kind: "win-loss" as const,
      value:
        outcome.type === "DRAW"
          ? ("draw" as const)
          : outcome.winnerSlotId === playerSlotId
            ? ("win" as const)
            : ("loss" as const),
    };
  },
};
