import type { PlayerSlotId } from "@online-game-hub/game-sdk";

export type ReversiConfig = null;
export type ReversiDisc = "BLACK" | "WHITE";
export type ReversiBoard = readonly (PlayerSlotId | null)[];
export type ReversiDiscCounts = {
  readonly BLACK: number;
  readonly WHITE: number;
};

export type ReversiState = {
  readonly players: readonly [PlayerSlotId, PlayerSlotId];
  readonly board: ReversiBoard;
  readonly nextPlayerIndex: 0 | 1;
  readonly resignedSlotId: PlayerSlotId | null;
};

export type ReversiAction =
  | {
      readonly type: "PLACE_DISC";
      readonly cell: number;
    }
  | { readonly type: "RESIGN" };

export type ReversiOutcome =
  | {
      readonly type: "WIN";
      readonly winnerSlotId: PlayerSlotId;
      readonly discCounts: ReversiDiscCounts;
    }
  | {
      readonly type: "WIN";
      readonly reason: "RESIGNATION";
      readonly winnerSlotId: PlayerSlotId;
      readonly resignedSlotId: PlayerSlotId;
    }
  | { readonly type: "DRAW"; readonly discCounts: ReversiDiscCounts };

export type ReversiView = {
  readonly players: readonly [
    { readonly slotId: PlayerSlotId; readonly disc: "BLACK" },
    { readonly slotId: PlayerSlotId; readonly disc: "WHITE" },
  ];
  readonly board: ReversiBoard;
  readonly nextTurnSlotId: PlayerSlotId | null;
  readonly legalMoves: readonly number[];
  readonly discCounts: ReversiDiscCounts;
  readonly outcome: ReversiOutcome | null;
  readonly yourDisc: ReversiDisc | null;
};

export type ReversiRuleErrorCode =
  | "NOT_A_PLAYER"
  | "NOT_YOUR_TURN"
  | "CELL_OUT_OF_BOUNDS"
  | "CELL_OCCUPIED"
  | "NO_DISC_CAPTURED"
  | "MATCH_ALREADY_FINISHED";
