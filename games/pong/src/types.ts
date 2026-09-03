import type { RealtimePlayerSlotId } from "@online-game-hub/realtime-game-sdk";

export type PongConfig = { readonly targetScore: number };
export type PongDirection = -1 | 0 | 1;
export type PongInput =
  | { readonly type: "DIRECTION"; readonly direction: PongDirection }
  | { readonly type: "RESIGN" };

export type PongOutcome = {
  readonly type: "WIN";
  readonly reason: "SCORE" | "RESIGNATION";
  readonly winnerSlotId: RealtimePlayerSlotId;
  readonly resignedSlotId?: RealtimePlayerSlotId;
  readonly scores: readonly [number, number];
};

export type PongState = {
  readonly players: readonly [RealtimePlayerSlotId, RealtimePlayerSlotId];
  readonly targetScore: number;
  readonly tick: number;
  readonly paddles: readonly [
    { readonly y: number; readonly direction: PongDirection },
    { readonly y: number; readonly direction: PongDirection },
  ];
  readonly ball: {
    readonly x: number;
    readonly y: number;
    readonly velocityX: number;
    readonly velocityY: number;
  };
  readonly scores: readonly [number, number];
  readonly resignedSlotId: RealtimePlayerSlotId | null;
};

export type PongView = {
  readonly field: { readonly width: number; readonly height: number };
  readonly players: readonly [
    { readonly slotId: RealtimePlayerSlotId; readonly side: "LEFT" },
    { readonly slotId: RealtimePlayerSlotId; readonly side: "RIGHT" },
  ];
  readonly paddles: readonly [
    { readonly y: number; readonly height: number },
    { readonly y: number; readonly height: number },
  ];
  readonly ball: {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
  };
  readonly scores: readonly [number, number];
  readonly tick: number;
  readonly targetScore: number;
  readonly yourSide: "LEFT" | "RIGHT" | null;
  readonly outcome: PongOutcome | null;
};
