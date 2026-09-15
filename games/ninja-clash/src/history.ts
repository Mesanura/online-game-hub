import { outcomeSchema } from "./contracts.js";
export const ninjaClashHistory = {
  gameId: "ninja-clash",
  gameVersions: ["1.0.0", "1.1.0"] as readonly string[],
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
      !["1.0.0", "1.1.0"].includes(gameVersion) ||
      players.length < 2 ||
      players.length > 4 ||
      new Set(players).size !== players.length ||
      !players.includes(playerSlotId)
    )
      return null;
    const parsed = outcomeSchema.safeParse(recordedOutcome);
    if (!parsed.success) return null;
    const outcome = parsed.data;
    if (
      outcome.standings.length !== players.length ||
      outcome.standings.some((p) => !players.includes(p.slotId))
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
