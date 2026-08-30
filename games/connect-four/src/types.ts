import type { PlayerSlotId } from "@online-game-hub/game-sdk";

export type ConnectFourConfig = null;
export type ConnectFourDisc = "RED" | "YELLOW";
export type ConnectFourBoard = readonly (PlayerSlotId | null)[];

export type ConnectFourState = {
  readonly players: readonly [PlayerSlotId, PlayerSlotId];
  readonly board: ConnectFourBoard;
  readonly nextPlayerIndex: 0 | 1;
};

export type ConnectFourAction = {
  readonly type: "DROP_DISC";
  readonly column: number;
};

export type ConnectFourOutcome =
  | {
      readonly type: "WIN";
      readonly winnerSlotId: PlayerSlotId;
      readonly winningCells: readonly [number, number, number, number];
    }
  | { readonly type: "DRAW" };

export type ConnectFourView = {
  readonly players: readonly [
    { readonly slotId: PlayerSlotId; readonly disc: "RED" },
    { readonly slotId: PlayerSlotId; readonly disc: "YELLOW" },
  ];
  readonly board: ConnectFourBoard;
  readonly nextTurnSlotId: PlayerSlotId | null;
  readonly outcome: ConnectFourOutcome | null;
  readonly yourDisc: ConnectFourDisc | null;
};

export type ConnectFourRuleErrorCode =
  | "NOT_A_PLAYER"
  | "NOT_YOUR_TURN"
  | "COLUMN_OUT_OF_BOUNDS"
  | "COLUMN_FULL"
  | "MATCH_ALREADY_FINISHED";
