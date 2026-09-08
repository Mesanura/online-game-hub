import type { SurfaceResultSummaryV2 } from "@online-game-hub/game-surface-bridge";
import type { ControlIntent, PlayView } from "./contracts";

export type Control =
  "left" | "right" | "jump" | "clear" | "drop" | "smash" | "serve";
export const KEY_CONTROLS: Readonly<Record<string, Control>> = Object.freeze({
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyW: "jump",
  ArrowUp: "jump",
  Space: "jump",
  KeyJ: "clear",
  KeyK: "smash",
  KeyL: "drop",
  KeyS: "serve",
});

// Each key/pointer is independent, so lifting one finger never cancels another.
export class ControlState {
  readonly #sources = new Map<string, Control>();
  press(source: string, control: Control): void {
    this.#sources.set(source, control);
  }
  release(source: string): void {
    this.#sources.delete(source);
  }
  reset(): void {
    this.#sources.clear();
  }
  get active(): boolean {
    return this.#sources.size > 0;
  }
  has(control: Control): boolean {
    return [...this.#sources.values()].includes(control);
  }
  intent(): ControlIntent {
    const active = new Set(this.#sources.values());
    return {
      type: "CONTROL",
      move:
        active.has("left") === active.has("right")
          ? 0
          : active.has("left")
            ? -1
            : 1,
      jump: active.has("jump"),
      serve: active.has("serve"),
      shot: active.has("smash")
        ? "SMASH"
        : active.has("drop")
          ? "DROP"
          : active.has("clear")
            ? "CLEAR"
            : "NONE",
    };
  }
}

export function interpolationAlpha(
  previous: PlayView | null,
  current: PlayView,
  elapsed: number,
  reducedMotion: boolean,
): number {
  if (
    reducedMotion ||
    previous === null ||
    !["RALLY", "SERVE", "SERVING"].includes(current.phase) ||
    previous.phase !== current.phase ||
    previous.rally !== current.rally ||
    current.tick <= previous.tick ||
    current.tick - previous.tick > 12
  )
    return 1;
  return Math.max(
    0,
    Math.min(1, elapsed / (((current.tick - previous.tick) * 1000) / 60)),
  );
}

export function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

export class ServeRequest {
  #rally: number | null = null;
  get pending(): boolean {
    return this.#rally !== null;
  }
  press(view: PlayView): void {
    if (
      view.phase === "SERVE" &&
      view.yourSide === view.servingSide &&
      view.outcome === null
    )
      this.#rally ??= view.rally;
  }
  observe(view: PlayView): void {
    if (view.phase !== "SERVE" || view.rally !== this.#rally) this.reset();
  }
  reset(): void {
    this.#rally = null;
  }
}

export function resultSummary(
  view: PlayView,
): Omit<SurfaceResultSummaryV2, "type" | "stateSequence"> | null {
  if (view.outcome === null) return null;
  const own = view.players.find((player) => player.side === view.yourSide);
  const won = view.outcome.winnerSlotId === own?.slotId;
  return {
    tone: own === undefined ? "neutral" : won ? "win" : "loss",
    headline:
      own === undefined
        ? "比赛结束"
        : won
          ? "好球，你赢了！"
          : "对手赢下了这一局",
    details: [
      `蓝方 ${view.scores[0]} : ${view.scores[1]} 橙方`,
      view.outcome.reason === "RESIGNATION"
        ? "本局因投降结束"
        : "本局达到获胜比分",
      `最长回合 ${view.bestRally} 拍`,
    ],
  };
}

export function phaseLabel(view: PlayView, gameVersion = "1.1.0"): string {
  if (view.outcome !== null) return resultSummary(view)?.headline ?? "比赛结束";
  if (view.phase === "SERVE")
    return gameVersion === "1.0.0"
      ? `${view.servingSide === view.yourSide ? "你" : "对手"}发球 · ${Math.ceil(view.phaseTicks / 60)}`
      : view.servingSide === view.yourSide
        ? "你的发球"
        : "等待对手发球";
  if (view.phase === "SERVING")
    return view.servingSide === view.yourSide ? "你正在发球" : "对手正在发球";
  if (view.phase === "POINT" && view.lastPoint !== null) {
    const side = view.lastPoint.winner === 0 ? "LEFT" : "RIGHT";
    const reason =
      view.lastPoint.reason === "NET"
        ? "触网"
        : view.lastPoint.reason === "OUT"
          ? "出界"
          : "落地";
    return `${side === view.yourSide ? "你" : "对手"}得分 · ${reason}`;
  }
  return view.rallyHits > 1
    ? `${view.rallyHits} 拍来回，好球！`
    : "看准落点，准备接球";
}
