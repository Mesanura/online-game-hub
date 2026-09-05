import type { SurfaceResultSummaryV2 } from "@online-game-hub/game-surface-bridge";

import {
  HEX_BOARD_SIZE,
  type HexPlayIntent,
  type HexPlayView,
  type HexSetupIntent,
  type HexSetupView,
} from "./contracts";

export function createSetupIntent(
  starter: HexSetupIntent["starter"],
): HexSetupIntent {
  return { type: "SELECT_STARTER", starter };
}

export function createPlaceStoneIntent(cell: number): HexPlayIntent {
  return { type: "PLACE_STONE", cell };
}

export function createResignIntent(): HexPlayIntent {
  return { type: "RESIGN" };
}

export function coordinateLabel(cell: number): string {
  const row = Math.floor(cell / HEX_BOARD_SIZE);
  const column = cell % HEX_BOARD_SIZE;
  return `${String.fromCharCode(65 + row)}${column + 1}`;
}

export function layoutForCell(cell: number): {
  readonly row: number;
  readonly column: number;
  readonly x: number;
  readonly y: number;
} {
  const row = Math.floor(cell / HEX_BOARD_SIZE);
  const column = cell % HEX_BOARD_SIZE;
  return {
    row,
    column,
    x: ((row + column) * 3) / 4,
    y: (column - row) / 2,
  };
}

export function setupStatusLabel(view: Readonly<HexSetupView>): string {
  if (view.participantSlotIds.length < 2) return "等待另一位玩家加入";
  if (view.starter === "UNSELECTED") return "请选择本局蓝方玩家";
  if (view.starter === "OWNER") return "房主使用蓝棋并先手";
  if (view.starter === "NON_OWNER") return "另一位玩家使用蓝棋并先手";
  if (view.starter === "RANDOM") return "开始时由服务端随机决定蓝方";
  return "沿用上一局的实际棋色与顺序";
}

export function colorForSlot(
  view: Readonly<HexPlayView>,
  slotId: string | null,
): "BLUE" | "RED" | null {
  if (slotId === null) return null;
  return view.players.find((player) => player.slotId === slotId)?.color ?? null;
}

function colorLabel(color: "BLUE" | "RED"): string {
  return color === "BLUE" ? "蓝方" : "红方";
}

export function outcomeLabel(view: Readonly<HexPlayView>): string {
  const outcome = view.outcome;
  if (outcome === null) return "";
  const winnerColor = colorForSlot(view, outcome.winnerSlotId);
  if (winnerColor === null) return "比赛已分出胜负";
  const winner =
    view.yourColor === null
      ? colorLabel(winnerColor)
      : view.yourColor === winnerColor
        ? `你（${colorLabel(winnerColor)}）`
        : `对手（${colorLabel(winnerColor)}）`;
  return outcome.reason === "CONNECTION"
    ? `胜者：${winner}，已连通对应两边`
    : `胜者：${winner}，对手投降`;
}

export function resultSummary(
  view: Readonly<HexPlayView>,
): Omit<SurfaceResultSummaryV2, "type" | "stateSequence"> | null {
  const outcome = view.outcome;
  if (outcome === null) return null;
  const ownSlot = view.players.find(
    (player) => player.color === view.yourColor,
  )?.slotId;
  const won = ownSlot !== undefined && outcome.winnerSlotId === ownSlot;
  return {
    tone: ownSlot === undefined ? "neutral" : won ? "win" : "loss",
    headline:
      ownSlot === undefined ? "本局已分出胜负" : won ? "你获胜" : "对手获胜",
    details: [
      outcome.reason === "CONNECTION" ? "胜方已连通对应两边" : "本局因投降结束",
    ],
  };
}
