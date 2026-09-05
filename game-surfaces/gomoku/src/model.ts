import type {
  GomokuPlayIntent,
  GomokuPlayView,
  GomokuSetupIntent,
  GomokuSetupView,
} from "./contracts";

export function createSetupIntent(
  starter: GomokuSetupIntent["starter"],
): GomokuSetupIntent {
  return { type: "SELECT_STARTER", starter };
}

export function createPlaceStoneIntent(cell: number): GomokuPlayIntent {
  return { type: "PLACE_STONE", cell };
}

export function createResignIntent(): GomokuPlayIntent {
  return { type: "RESIGN" };
}

export function setupStatusLabel(view: Readonly<GomokuSetupView>): string {
  if (view.participantSlotIds.length < 2) return "等待另一位玩家加入";
  if (view.starter === "UNSELECTED") return "请选择本局先手";
  if (view.starter === "OWNER") return "房主使用黑棋并先手";
  if (view.starter === "NON_OWNER") return "另一位玩家使用黑棋并先手";
  if (view.starter === "RANDOM") return "开始时由服务端随机决定黑棋";
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
