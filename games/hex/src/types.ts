import type { PlayerSlotId } from "@online-game-hub/game-sdk";

export type HexConfig = null;
export type HexColor = "BLUE" | "RED";
export type HexBoard = readonly (PlayerSlotId | null)[];

export type HexState = {
  readonly players: readonly [PlayerSlotId, PlayerSlotId];
  readonly board: HexBoard;
  readonly nextPlayerIndex: 0 | 1;
  readonly resignedSlotId: PlayerSlotId | null;
};

export type HexAction =
  | { readonly type: "PLACE_STONE"; readonly cell: number }
  | { readonly type: "RESIGN" };

export type HexOutcome =
  | {
      readonly type: "WIN";
      readonly reason: "CONNECTION";
      readonly winnerSlotId: PlayerSlotId;
      readonly winningPath: readonly number[];
    }
  | {
      readonly type: "WIN";
      readonly reason: "RESIGNATION";
      readonly winnerSlotId: PlayerSlotId;
      readonly resignedSlotId: PlayerSlotId;
    };

export type HexView = {
  readonly players: readonly [
    { readonly slotId: PlayerSlotId; readonly color: "BLUE" },
    { readonly slotId: PlayerSlotId; readonly color: "RED" },
  ];
  readonly board: HexBoard;
  readonly nextTurnSlotId: PlayerSlotId | null;
  readonly outcome: HexOutcome | null;
  readonly yourColor: HexColor | null;
};

export type HexRuleErrorCode =
  | "NOT_A_PLAYER"
  | "NOT_YOUR_TURN"
  | "CELL_OUT_OF_BOUNDS"
  | "CELL_OCCUPIED"
  | "MATCH_ALREADY_FINISHED";
