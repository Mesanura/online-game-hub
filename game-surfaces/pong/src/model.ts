import type { SurfaceResultSummaryV2 } from "@online-game-hub/game-surface-bridge";

import type {
  PongPlayIntent,
  PongPlayView,
  PongSetupIntent,
  PongSetupView,
} from "./contracts";

export function createSetupIntent(
  starter: PongSetupIntent["starter"],
): PongSetupIntent {
  return { type: "SELECT_STARTER", starter };
}

export function createDirectionIntent(direction: -1 | 0 | 1): PongPlayIntent {
  return { type: "DIRECTION", direction };
}

export function createResignIntent(): PongPlayIntent {
  return { type: "RESIGN" };
}

export function interpolationAlpha(
  elapsedMilliseconds: number,
  tickRate = 60,
): number {
  if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds <= 0)
    return 0;
  if (!Number.isFinite(tickRate) || tickRate <= 0) return 1;
  return Math.min(1, elapsedMilliseconds / (1000 / tickRate));
}

export function lerp(previous: number, current: number, alpha: number): number {
  return Math.round(previous + (current - previous) * alpha);
}

export function setupStatusLabel(view: Readonly<PongSetupView>): string {
  if (view.participantSlotIds.length < 2) return "等待另一位玩家加入";
  if (view.starter === "UNSELECTED") return "请选择本局发球方";
  if (view.starter === "OWNER") return "房主将在本局先发球";
  if (view.starter === "NON_OWNER") return "另一位玩家将先发球";
  if (view.starter === "RANDOM") return "开始时由服务端随机决定发球方";
  return "沿用上一局的实际发球顺序";
}

export function winnerText(view: Readonly<PongPlayView>): string {
  const outcome = view.outcome;
  if (outcome === null) return "";
  const yourPlayer = view.players.find(
    (player) => player.side === view.yourSide,
  );
  if (yourPlayer === undefined) return "比赛结束";
  return outcome.winnerSlotId === yourPlayer.slotId ? "你赢了" : "对手获胜";
}

export function resultSummary(
  view: Readonly<PongPlayView>,
): Omit<SurfaceResultSummaryV2, "type" | "stateSequence"> | null {
  const outcome = view.outcome;
  if (outcome === null) return null;
  const ownSlot = view.players.find(
    (player) => player.side === view.yourSide,
  )?.slotId;
  const won = ownSlot !== undefined && outcome.winnerSlotId === ownSlot;
  return {
    tone: ownSlot === undefined ? "neutral" : won ? "win" : "loss",
    headline: ownSlot === undefined ? "比赛结束" : won ? "你获胜" : "对手获胜",
    details: [
      `左侧 ${outcome.scores[0]} : ${outcome.scores[1]} 右侧`,
      outcome.reason === "RESIGNATION" ? "本局因投降结束" : "率先达到目标分数",
    ],
  };
}
