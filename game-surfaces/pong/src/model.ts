import type { SurfaceResultSummaryV2 } from "@online-game-hub/game-surface-bridge";

import type {
  PongPlayIntent,
  PongPlayView,
  PongSetupIntent,
  PongSetupView,
} from "./contracts";
import {
  PONG_LEGACY_SERVE_DELAY_TICKS,
  PONG_SERVE_DELAY_TICKS,
} from "./contracts";

export function serveArrowVisible(
  view: Readonly<PongPlayView>,
  reducedMotion: boolean,
  gameVersion = "1.2.0",
): boolean {
  if (view.serve === null || view.outcome !== null) return false;
  const duration =
    gameVersion === "1.1.0"
      ? PONG_LEGACY_SERVE_DELAY_TICKS
      : PONG_SERVE_DELAY_TICKS;
  return (
    reducedMotion ||
    Math.floor((duration - view.serve.ticksRemaining) / 30) % 2 === 0
  );
}

export function createSetupIntent(
  starter: Extract<PongSetupIntent, { type: "SELECT_STARTER" }>["starter"],
): PongSetupIntent {
  return { type: "SELECT_STARTER", starter };
}

export function createTargetScoreIntent(targetScore: number): PongSetupIntent {
  return { type: "SET_TARGET_SCORE", targetScore };
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
  if (view.starter === "UNSELECTED") return "请选择本局左右站位";
  if (view.starter === "OWNER") return "房主在左，对手在右";
  if (view.starter === "NON_OWNER") return "对手在左，房主在右";
  if (view.starter === "RANDOM") return "开局时随机决定左右站位";
  return "沿用上一局的实际左右站位";
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
