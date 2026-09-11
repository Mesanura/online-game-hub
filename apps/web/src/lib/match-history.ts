import type { MatchHistoryResult } from "@online-game-hub/game-registry/history-types";

/** Public account history DTO; contains no archived projection inputs. */
export interface AccountMatchHistoryItem {
  readonly matchId: string;
  readonly roundNumber: number;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly status: "waiting" | "active" | "completed" | "abandoned";
  readonly finalRevision: number;
  readonly playerSlotId: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly replayAvailable: boolean;
  readonly result: MatchHistoryResult | null;
}
