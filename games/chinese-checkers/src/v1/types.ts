import type { PlayerSlotId } from "@online-game-hub/game-sdk";

export type ChineseCheckersConfig = null;
export type ChineseCheckersCamp = "N" | "NE" | "SE" | "S" | "SW" | "NW";
export type ChineseCheckersBoard = readonly (PlayerSlotId | null)[];
export type ChineseCheckersRankReason =
  "FINISHED" | "RESIGNATION" | "BLOCKED" | "LAST_REMAINING";
export type ChineseCheckersPlayer = {
  readonly slotId: PlayerSlotId;
  readonly camp: ChineseCheckersCamp;
};
export type ChineseCheckersRanking = {
  readonly slotId: PlayerSlotId;
  readonly rank: number;
  readonly reason: ChineseCheckersRankReason;
};
export type ChineseCheckersAction =
  | { readonly type: "MOVE_PIECE"; readonly from: number; readonly to: number }
  | { readonly type: "RESIGN" };
export type ChineseCheckersOutcome = {
  readonly type: "RANKING";
  readonly rankings: readonly ChineseCheckersRanking[];
};
export type ChineseCheckersState = {
  readonly players: readonly ChineseCheckersPlayer[];
  readonly board: ChineseCheckersBoard;
  readonly nextPlayerIndex: number;
  readonly rankings: readonly ChineseCheckersRanking[];
  readonly resignedSlotIds: readonly PlayerSlotId[];
};
export type ChineseCheckersView = {
  readonly players: readonly ChineseCheckersPlayer[];
  readonly board: ChineseCheckersBoard;
  readonly nextTurnSlotId: PlayerSlotId | null;
  readonly legalMoves: readonly {
    readonly from: number;
    readonly to: number;
  }[];
  readonly rankings: readonly ChineseCheckersRanking[];
  readonly outcome: ChineseCheckersOutcome | null;
  readonly yourCamp: ChineseCheckersCamp | null;
};
export type ChineseCheckersRuleErrorCode =
  | "NOT_A_PLAYER"
  | "NOT_YOUR_TURN"
  | "PLAYER_ALREADY_RANKED"
  | "CELL_OUT_OF_BOUNDS"
  | "SOURCE_NOT_OWNED"
  | "DESTINATION_OCCUPIED"
  | "ILLEGAL_MOVE"
  | "MATCH_ALREADY_FINISHED";
