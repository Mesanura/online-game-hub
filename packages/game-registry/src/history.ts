import { ticTacToeHistory } from "@online-game-hub/tic-tac-toe/history";
import { connectFourHistory } from "@online-game-hub/connect-four/history";
import { gomokuHistory } from "@online-game-hub/gomoku/history";
import { hexHistory } from "@online-game-hub/hex/history";
import { reversiHistory } from "@online-game-hub/reversi/history";
import { chineseCheckersHistory } from "@online-game-hub/chinese-checkers/history";
import { pongHistory } from "@online-game-hub/pong/history";
import { badmintonHistory } from "@online-game-hub/badminton/history";
import { tankMazeHistory } from "@online-game-hub/tank-maze/history";
import type {
  GameHistoryProjection,
  MatchHistoryResult,
} from "./history-types.js";

const histories: readonly GameHistoryProjection[] = [
  ticTacToeHistory,
  connectFourHistory,
  gomokuHistory,
  hexHistory,
  reversiHistory,
  chineseCheckersHistory,
  pongHistory,
  badmintonHistory,
  tankMazeHistory,
];

export function resolveGameHistoryProjection(
  gameId: string,
  gameVersion: string,
): GameHistoryProjection | undefined {
  return histories.find(
    (history) =>
      history.gameId === gameId && history.gameVersions.includes(gameVersion),
  );
}

/** Accepts only archived participant slots and returns a minimal public projection. */
export function projectMatchHistoryResult(context: {
  readonly gameId: string;
  readonly gameVersion: string;
  readonly status: string;
  readonly recordedOutcome: unknown;
  readonly players: unknown;
  readonly playerSlotId: string;
}): MatchHistoryResult | null {
  if (context.status !== "completed") return null;
  const history = resolveGameHistoryProjection(
    context.gameId,
    context.gameVersion,
  );
  if (history === undefined || !Array.isArray(context.players)) return null;
  const players: string[] = [];
  for (const entry of context.players) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("slotId" in entry) ||
      typeof entry.slotId !== "string" ||
      entry.slotId.length === 0
    )
      return null;
    players.push(entry.slotId);
  }
  return history.projectView({
    gameVersion: context.gameVersion,
    recordedOutcome: context.recordedOutcome,
    players,
    playerSlotId: context.playerSlotId,
  });
}
