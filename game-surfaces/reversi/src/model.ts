import type {
  ReversiPlayIntent,
  ReversiPlayView,
  ReversiSetupIntent,
  ReversiSetupView,
} from "./contracts";

export function createSetupIntent(
  starter: ReversiSetupIntent["starter"],
): ReversiSetupIntent {
  return { type: "SELECT_STARTER", starter };
}

export function createPlaceDiscIntent(cell: number): ReversiPlayIntent {
  return { type: "PLACE_DISC", cell };
}

export function coordinateLabel(cell: number): string {
  return `${String.fromCharCode(65 + (cell % 8))}${Math.floor(cell / 8) + 1}`;
}

export function setupStatusLabel(view: Readonly<ReversiSetupView>): string {
  if (view.participantSlotIds.length < 2) return "等待另一位玩家加入";
  if (view.starter === "UNSELECTED") return "请选择本局黑棋玩家";
  if (view.starter === "OWNER") return "房主使用黑棋并先手";
  if (view.starter === "NON_OWNER") return "另一位玩家使用黑棋并先手";
  if (view.starter === "RANDOM") return "开始时由服务端随机决定黑棋";
  return "沿用上一局的实际棋色与顺序";
}

export function discForSlot(
  view: Readonly<ReversiPlayView>,
  slotId: string | null,
): "BLACK" | "WHITE" | null {
  if (slotId === null) return null;
  return view.players.find((player) => player.slotId === slotId)?.disc ?? null;
}

function discLabel(disc: "BLACK" | "WHITE"): string {
  return disc === "BLACK" ? "黑方" : "白方";
}

export function outcomeLabel(view: Readonly<ReversiPlayView>): string {
  const outcome = view.outcome;
  if (outcome === null) return "";
  if (outcome.type === "WIN" && "reason" in outcome) {
    const winnerDisc = discForSlot(view, outcome.winnerSlotId);
    if (winnerDisc === null) return "比赛已因投降分出胜负";
    if (view.yourDisc === null)
      return `胜者：${discLabel(winnerDisc)}（对手投降）`;
    return `胜者：${view.yourDisc === winnerDisc ? "你" : "对手"}（${discLabel(winnerDisc)}，投降）`;
  }
  const score = `${outcome.discCounts.BLACK} 比 ${outcome.discCounts.WHITE}`;
  if (outcome.type === "DRAW") return `平局（${score}）`;
  const winnerDisc = discForSlot(view, outcome.winnerSlotId);
  if (winnerDisc === null) return `比赛已分出胜负（${score}）`;
  if (view.yourDisc === null)
    return `胜者：${discLabel(winnerDisc)}（${score}）`;
  return `胜者：${view.yourDisc === winnerDisc ? "你" : "对手"}（${discLabel(winnerDisc)}，${score}）`;
}
