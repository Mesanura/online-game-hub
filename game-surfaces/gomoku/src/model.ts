import type { SurfaceResultSummaryV2 } from "@online-game-hub/game-surface-bridge";

import type {
  GomokuPlayIntent,
  GomokuPlayView,
  GomokuSetupIntent,
  GomokuSetupView,
} from "./contracts";

export function createSetupIntent(
  starter: Extract<GomokuSetupIntent, { type: "SELECT_STARTER" }>["starter"],
): GomokuSetupIntent {
  return { type: "SELECT_STARTER", starter };
}

export function createBoardSizeIntent(boardSize: 15 | 19): GomokuSetupIntent {
  return { type: "SET_BOARD_SIZE", boardSize };
}

export function createPlaceStoneIntent(cell: number): GomokuPlayIntent {
  return { type: "PLACE_STONE", cell };
}

export function createResignIntent(): GomokuPlayIntent {
  return { type: "RESIGN" };
}

export function setupStatusLabel(view: Readonly<GomokuSetupView>): string {
  if (view.starter === "UNSELECTED") return "请选择本局先手";
  if (view.starter === "OWNER") return "房主使用黑棋并先手";
  if (view.starter === "NON_OWNER") return "另一位玩家使用黑棋并先手";
  if (view.starter === "RANDOM") return "开始时随机决定黑棋";
  return "沿用上一局的实际棋色与顺序";
}

export function outcomeLabel(view: Readonly<GomokuPlayView>): string {
  if (view.outcome === null) return "";
  if (view.outcome.type === "DRAW") return "本局平局";
  const ownSlot = view.players.find(
    (player) => player.stone === view.yourStone,
  )?.slotId;
  if (ownSlot === undefined) return "本局已结束";
  return view.outcome.winnerSlotId === ownSlot ? "你赢了" : "对手获胜";
}

export function resultSummary(
  view: Readonly<GomokuPlayView>,
): Omit<SurfaceResultSummaryV2, "type" | "stateSequence"> | null {
  const outcome = view.outcome;
  if (outcome === null) return null;
  if (outcome.type === "DRAW") return { tone: "draw", headline: "平局" };
  const ownSlot = view.players.find(
    (player) => player.stone === view.yourStone,
  )?.slotId;
  const won = ownSlot !== undefined && outcome.winnerSlotId === ownSlot;
  return {
    tone: ownSlot === undefined ? "neutral" : won ? "win" : "loss",
    headline:
      ownSlot === undefined ? "本局已分出胜负" : won ? "你获胜" : "对手获胜",
    ...("reason" in outcome && outcome.reason === "RESIGNATION"
      ? { details: ["本局因投降结束"] }
      : {}),
  };
}
