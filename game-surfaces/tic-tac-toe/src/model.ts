import type {
  TicTacToeCellIndex,
  TicTacToePlayIntent,
  TicTacToePlayView,
  TicTacToeSetupIntent,
  TicTacToeSetupView,
} from "./contracts";

export function createSetupIntent(
  starter: TicTacToeSetupIntent["starter"],
): TicTacToeSetupIntent {
  return { type: "SELECT_STARTER", starter };
}

export function createPlayIntent(
  cell: TicTacToeCellIndex,
): TicTacToePlayIntent {
  return { type: "PLACE_MARK", cell };
}

export function createResignIntent(): TicTacToePlayIntent {
  return { type: "RESIGN" };
}

export function markForSlot(
  view: Readonly<TicTacToePlayView>,
  slotId: string | null,
): "X" | "O" | null {
  if (slotId === null) return null;
  return view.players.find((player) => player.slotId === slotId)?.mark ?? null;
}

export function playStatusLabel(view: Readonly<TicTacToePlayView>): string {
  if (view.outcome?.type === "DRAW") return "本局平局";
  if (view.outcome?.type === "WIN") {
    const winnerMark = markForSlot(view, view.outcome.winnerSlotId);
    if (view.yourMark === null || winnerMark === null) return "本局已分出胜负";
    return view.yourMark === winnerMark ? "你赢了" : "对手获胜";
  }
  const nextMark = markForSlot(view, view.nextTurnSlotId);
  if (nextMark === null) return "等待服务器同步回合";
  if (view.yourMark === nextMark) return "轮到你落子";
  return `等待 ${nextMark} 落子`;
}

export function setupStatusLabel(view: Readonly<TicTacToeSetupView>): string {
  if (view.participantSlotIds.length < 2) return "等待另一位玩家加入";
  if (view.starter === "UNSELECTED") return "请选择本局先手";
  if (view.starter === "OWNER") return "房主将在本局先手";
  if (view.starter === "NON_OWNER") return "另一位玩家将在本局先手";
  if (view.starter === "RANDOM") return "开始时由服务端随机决定先手";
  return "沿用上一局的实际先手顺序";
}
