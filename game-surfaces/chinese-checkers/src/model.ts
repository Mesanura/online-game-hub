import type { SurfaceResultSummaryV2 } from "@online-game-hub/game-surface-bridge";

import {
  type CHINESE_CHECKERS_CAMPS,
  chineseCheckersLegacyPlayViewSchema,
  chineseCheckersPlayViewSchema,
  type ChineseCheckersPlayIntent,
  type ChineseCheckersPlayView,
  type ChineseCheckersSetupIntent,
  type ChineseCheckersSetupView,
} from "./contracts";
import { LEGACY_GEOMETRY } from "./legacy-geometry";

export type ChineseCheckersCamp = (typeof CHINESE_CHECKERS_CAMPS)[number];

export const campLabels: Readonly<Record<ChineseCheckersCamp, string>> = {
  N: "北营地（1号）",
  NE: "东北营地（2号）",
  SE: "东南营地（3号）",
  S: "南营地（4号）",
  SW: "西南营地（5号）",
  NW: "西北营地（6号）",
};

export function parsePlayView(
  input: unknown,
  gameVersion: string,
): ChineseCheckersPlayView {
  if (gameVersion === "1.1.0")
    return chineseCheckersPlayViewSchema.parse(input);
  if (gameVersion === "1.0.0") {
    return {
      ...chineseCheckersLegacyPlayViewSchema.parse(input),
      geometry: LEGACY_GEOMETRY.map((cell) => ({ ...cell })),
    };
  }
  throw new Error("Unsupported Chinese Checkers version.");
}

export function createPlayerCountIntent(
  playerCount: number,
): ChineseCheckersSetupIntent {
  return { type: "SELECT_PLAYER_COUNT", playerCount };
}

export function createCampIntent(
  camp: ChineseCheckersCamp,
): ChineseCheckersSetupIntent {
  return { type: "SELECT_CAMP", camp };
}

export function createStarterIntent(
  starter: "OWNER" | "NON_OWNER" | "RANDOM",
): ChineseCheckersSetupIntent {
  return { type: "SELECT_STARTER", starter };
}

export function createStarterCampIntent(
  camp: ChineseCheckersCamp,
): ChineseCheckersSetupIntent {
  return { type: "SELECT_STARTER_CAMP", camp };
}

export function createMovePieceIntent(
  from: number,
  to: number,
): ChineseCheckersPlayIntent {
  return { type: "MOVE_PIECE", from, to };
}

export function createResignIntent(): ChineseCheckersPlayIntent {
  return { type: "RESIGN" };
}

export function legalTargetsForSelection(
  legalMoves: readonly { readonly from: number; readonly to: number }[],
  selectedCell: number | null,
): readonly number[] {
  if (selectedCell === null) return [];
  return legalMoves
    .filter((move) => move.from === selectedCell)
    .map((move) => move.to);
}

export function setupStatusLabel(
  view: Readonly<ChineseCheckersSetupView>,
): string {
  if (view.participants.length !== view.targetPlayerCount) {
    return `等待 ${view.targetPlayerCount} 位玩家加入（当前 ${view.participants.length} 位）`;
  }
  if (view.participants.some((participant) => participant.camp === null)) {
    return "每位玩家需要选择一个不同的营地";
  }
  if (view.starter === "UNSELECTED") return "房主需要选择本局首位";
  if (
    view.starter === "CAMP" &&
    view.starterCamp !== null &&
    !view.participants.some(
      (participant) => participant.camp === view.starterCamp,
    )
  ) {
    return `等待玩家选择${campLabels[view.starterCamp]}，或请房主重新指定首位`;
  }
  if (view.starter === "FIXED") return "沿用上一局的完整营地与实际顺序";
  return "设置完成，所有参与者可以分别准备";
}

export function campForSlot(
  view: Readonly<ChineseCheckersPlayView>,
  slotId: string | null,
): ChineseCheckersCamp | null {
  if (slotId === null) return null;
  return view.players.find((player) => player.slotId === slotId)?.camp ?? null;
}

export function outcomeLabel(view: Readonly<ChineseCheckersPlayView>): string {
  if (view.outcome === null) return "";
  const winner = view.outcome.rankings.find((entry) => entry.rank === 1);
  if (winner === undefined) return "本局排名已确定";
  const camp = campForSlot(view, winner.slotId);
  if (camp === null) return "本局排名已确定";
  return `第一名：${campLabels[camp]}`;
}

function rankingReasonLabel(
  reason: ChineseCheckersPlayView["rankings"][number]["reason"],
): string {
  if (reason === "FINISHED") return "完成目标营地";
  if (reason === "RESIGNATION") return "投降";
  if (reason === "BLOCKED") return "无路可走";
  return "最后一名未排名玩家";
}

export function resultSummary(
  view: Readonly<ChineseCheckersPlayView>,
): Omit<SurfaceResultSummaryV2, "type" | "stateSequence"> | null {
  if (view.outcome === null) return null;
  const ownSlot =
    view.yourCamp === null
      ? undefined
      : view.players.find((player) => player.camp === view.yourCamp)?.slotId;
  const ownRanking = view.outcome.rankings.find(
    (entry) => entry.slotId === ownSlot,
  );
  return {
    tone:
      ownRanking === undefined
        ? "neutral"
        : ownRanking.rank === 1
          ? "win"
          : "neutral",
    headline:
      ownRanking === undefined
        ? "本局排名已确定"
        : `你获得第 ${ownRanking.rank} 名`,
    details: view.outcome.rankings.map((entry) => {
      const camp = campForSlot(view, entry.slotId);
      const campLabel = camp === null ? "未知营地" : campLabels[camp];
      return `第 ${entry.rank} 名：${campLabel}（${rankingReasonLabel(entry.reason)}）`;
    }),
  };
}
