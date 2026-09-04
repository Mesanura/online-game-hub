import {
  CONNECT_FOUR_COLUMNS,
  CONNECT_FOUR_ROWS,
  type ConnectFourPlayIntent,
  type ConnectFourPlayView,
  type ConnectFourSetupIntent,
  type ConnectFourSetupView,
} from "./contracts";

export function createSetupIntent(
  starter: ConnectFourSetupIntent["starter"],
): ConnectFourSetupIntent {
  return { type: "SELECT_STARTER", starter };
}

export function createDropDiscIntent(column: number): ConnectFourPlayIntent {
  return { type: "DROP_DISC", column };
}

export function landingCell(
  board: ConnectFourPlayView["board"],
  column: number,
): number | null {
  if (
    !Number.isInteger(column) ||
    column < 0 ||
    column >= CONNECT_FOUR_COLUMNS
  ) {
    return null;
  }
  for (let row = CONNECT_FOUR_ROWS - 1; row >= 0; row -= 1) {
    const cell = row * CONNECT_FOUR_COLUMNS + column;
    if (board[cell] === null) return cell;
  }
  return null;
}

export function setupStatusLabel(view: Readonly<ConnectFourSetupView>): string {
  if (view.participantSlotIds.length < 2) return "等待另一位玩家加入";
  if (view.starter === "UNSELECTED") return "请选择本局先手";
  if (view.starter === "OWNER") return "房主使用红棋并先手";
  if (view.starter === "NON_OWNER") return "另一位玩家使用红棋并先手";
  if (view.starter === "RANDOM") return "开始时由服务端随机决定红棋";
  return "沿用上一局的实际棋色与顺序";
}

export function outcomeLabel(view: Readonly<ConnectFourPlayView>): string {
  if (view.outcome === null) return "";
  if (view.outcome.type === "DRAW") return "本局平局";
  const ownSlot = view.players.find(
    (player) => player.disc === view.yourDisc,
  )?.slotId;
  if (ownSlot === undefined) return "本局已结束";
  return view.outcome.winnerSlotId === ownSlot ? "你赢了" : "对手获胜";
}
