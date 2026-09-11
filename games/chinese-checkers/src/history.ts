import { chineseCheckersOutcomeSchema as outcomeSchema } from "./core/index.js";

const gameVersions: readonly string[] = ["1.0.0", "1.1.0"];

/** A pure, viewer-specific projection of archived results; never exposes Outcome. */
export const chineseCheckersHistory = {
  gameId: "chinese-checkers",
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
      players.length > 6 ||
      players.some((slot) => typeof slot !== "string" || slot.length === 0) ||
      new Set(players).size !== players.length ||
      !players.includes(playerSlotId)
    )
      return null;
    const parsed = outcomeSchema.safeParse(recordedOutcome);
    if (!parsed.success) return null;
    const outcome = parsed.data;
    const rankings = outcome.rankings;
    if (
      rankings.length !== players.length ||
      new Set(rankings.map((entry) => entry.slotId)).size !== players.length ||
      new Set(rankings.map((entry) => entry.rank)).size !== players.length ||
      rankings.some(
        (entry) =>
          !players.includes(entry.slotId) || entry.rank > players.length,
      )
    )
      return null;
    const own = rankings.find((entry) => entry.slotId === playerSlotId);
    return own === undefined
      ? null
      : { kind: "rank" as const, rank: own.rank, tied: false };
  },
};
