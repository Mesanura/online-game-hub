export type MatchHistoryResult =
  | { readonly kind: "win-loss"; readonly value: "win" | "loss" | "draw" }
  | { readonly kind: "rank"; readonly rank: number; readonly tied: boolean }
  | { readonly kind: "score"; readonly own: number; readonly opponent: number };

export interface GameHistoryProjection {
  readonly gameId: string;
  readonly gameVersions: readonly string[];
  projectView(context: {
    readonly gameVersion: string;
    readonly recordedOutcome: unknown;
    readonly players: readonly string[];
    readonly playerSlotId: string;
  }): MatchHistoryResult | null;
}
