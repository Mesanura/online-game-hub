import type { PlayerSlotId } from "@online-game-hub/game-sdk";

export type GomokuBoardSize = 15 | 19;
export type GomokuConfig = {
  readonly boardSize: GomokuBoardSize;
  readonly winLength: 5;
};
export type GomokuStone = "BLACK" | "WHITE";
export type GomokuBoard = readonly (PlayerSlotId | null)[];

export type GomokuState = {
  readonly config: GomokuConfig;
  readonly players: readonly [PlayerSlotId, PlayerSlotId];
  readonly board: GomokuBoard;
  readonly nextPlayerIndex: 0 | 1;
  readonly resignedSlotId: PlayerSlotId | null;
};

export type GomokuAction =
  | {
      readonly type: "PLACE_STONE";
      readonly cell: number;
    }
  | { readonly type: "RESIGN" };

export type GomokuOutcome =
  | {
      readonly type: "WIN";
      readonly winnerSlotId: PlayerSlotId;
      readonly winningCells: readonly [number, number, number, number, number];
    }
  | {
      readonly type: "WIN";
      readonly reason: "RESIGNATION";
      readonly winnerSlotId: PlayerSlotId;
      readonly resignedSlotId: PlayerSlotId;
    }
  | { readonly type: "DRAW" };

export type GomokuView = {
  readonly boardSize: GomokuBoardSize;
  readonly winLength: 5;
  readonly players: readonly [
    { readonly slotId: PlayerSlotId; readonly stone: "BLACK" },
    { readonly slotId: PlayerSlotId; readonly stone: "WHITE" },
  ];
  readonly board: GomokuBoard;
  readonly nextTurnSlotId: PlayerSlotId | null;
  readonly outcome: GomokuOutcome | null;
  readonly yourStone: GomokuStone | null;
};

export type GomokuRuleErrorCode =
  | "NOT_A_PLAYER"
  | "NOT_YOUR_TURN"
  | "CELL_OUT_OF_BOUNDS"
  | "CELL_OCCUPIED"
  | "MATCH_ALREADY_FINISHED";
