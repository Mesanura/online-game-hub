import type { SurfaceResultSummaryV2 } from "@online-game-hub/game-surface-bridge";
import type { Direction, Effect, PlayIntent, PlayView } from "./contracts";

const keys: Readonly<Record<string, Direction>> = {
  KeyW: "up",
  ArrowUp: "up",
  KeyD: "right",
  ArrowRight: "right",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
};
export function isControlKey(code: string): boolean {
  return code === "Space" || keys[code] !== undefined;
}
export function joystickPosition(
  dx: number,
  dy: number,
  radius: number,
  previous: Direction = "none",
) {
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || radius <= 0)
    return { x: 0, y: 0, direction: "none" as Direction };
  const ratio = distance > radius ? radius / distance : 1;
  let direction: Direction = "none";
  if (distance > radius * 0.2) {
    const horizontal = dx >= 0 ? "right" : "left";
    const vertical = dy >= 0 ? "down" : "up";
    direction =
      Math.abs(dx) === Math.abs(dy) &&
      (previous === horizontal || previous === vertical)
        ? previous
        : Math.abs(dx) >= Math.abs(dy)
          ? horizontal
          : vertical;
  }
  return { x: dx * ratio, y: dy * ratio, direction };
}
export class Controls {
  readonly #held = new Map<string, number>();
  readonly #bombTouches = new Set<number>();
  #order = 0;
  #sent: Direction = "none";
  #sentAt = -Infinity;
  stickId: number | null = null;
  stickDirection: Direction = "none";
  knob = { x: 0, y: 0 };
  get direction(): Direction {
    if (this.stickDirection !== "none") return this.stickDirection;
    const last = [...this.#held.entries()]
      .filter(([code]) => keys[code] !== undefined)
      .sort((a, b) => b[1] - a[1])[0];
    return last ? (keys[last[0]] ?? "none") : "none";
  }
  get bombHeld(): boolean {
    return this.#held.has("Space") || this.#bombTouches.size > 0;
  }
  get bombPointers(): number[] {
    return [...this.#bombTouches];
  }
  keyDown(code: string, repeat = false): boolean {
    if (!isControlKey(code) || repeat || this.#held.has(code)) return false;
    this.#held.set(code, ++this.#order);
    return code === "Space";
  }
  keyUp(code: string): void {
    this.#held.delete(code);
  }
  startStick(id: number): boolean {
    if (this.stickId !== null) return false;
    this.stickId = id;
    return true;
  }
  moveStick(id: number, dx: number, dy: number, radius: number): void {
    if (id !== this.stickId) return;
    const next = joystickPosition(dx, dy, radius, this.stickDirection);
    this.stickDirection = next.direction;
    this.knob = { x: next.x, y: next.y };
  }
  endStick(id: number): void {
    if (id !== this.stickId) return;
    this.stickId = null;
    this.stickDirection = "none";
    this.knob = { x: 0, y: 0 };
  }
  pressBomb(id: number): boolean {
    if (this.#bombTouches.has(id)) return false;
    this.#bombTouches.add(id);
    return true;
  }
  releaseBomb(id: number): void {
    this.#bombTouches.delete(id);
  }
  take(now: number): PlayIntent | null {
    const direction = this.direction;
    if (
      direction === this.#sent &&
      (direction === "none" || now - this.#sentAt < 150)
    )
      return null;
    this.#sent = direction;
    this.#sentAt = now;
    return { type: "MOVE", direction };
  }
  clear(): boolean {
    const active = this.direction !== "none" || this.#sent !== "none";
    this.#held.clear();
    this.#bombTouches.clear();
    this.stickId = null;
    this.stickDirection = "none";
    this.knob = { x: 0, y: 0 };
    this.#sent = "none";
    this.#sentAt = -Infinity;
    return active;
  }
}
export class EffectFeed {
  #primed = false;
  #lastId = 0;
  observe(events: readonly Effect[], reset = false): Effect[] {
    const newest = events.at(-1)?.id ?? 0;
    if (!this.#primed || reset) {
      this.#primed = true;
      this.#lastId = newest;
      return [];
    }
    const fresh = events.filter((event) => event.id > this.#lastId);
    this.#lastId = Math.max(this.#lastId, newest);
    return fresh;
  }
  clear(): void {
    this.#primed = false;
    this.#lastId = 0;
  }
}
export function phaseLabel(view: PlayView): string {
  const own = view.players.find((player) => player.slotId === view.selfSlotId);
  if (view.outcome) return resultSummary(view)?.headline ?? "本场结束";
  if (own?.resigned) return "已投降 · 等待本场结束";
  if (view.phase === "PREPARE") return "第 " + view.bout + " 小局 · 准备开炸";
  if (view.phase === "RESULT")
    return view.roundResult?.reason === "TIMEOUT"
      ? "时间到 · 本小局平局"
      : view.roundResult?.winnerSlotId
        ? "本小局结束 · 胜者 +1"
        : "全员出局 · 本小局平局";
  return own?.alive
    ? "炸开出路，成为最后的幸存者"
    : "本小局已出局 · 下一小局自动复活";
}
export function resultSummary(
  view: PlayView,
): Omit<SurfaceResultSummaryV2, "type" | "stateSequence"> | null {
  if (!view.outcome) return null;
  const winner = view.players.find(
    (player) => player.slotId === view.outcome?.winnerSlotId,
  );
  const won = view.outcome.winnerSlotId === view.selfSlotId;
  return {
    tone: winner ? (won ? "win" : "loss") : "draw",
    headline: winner
      ? won
        ? "你赢下了整场！"
        : "P" + (winner.index + 1) + " 赢得整场"
      : "本场平局",
    details: [
      ...view.outcome.scores.map(
        (score) =>
          "P" +
          ((view.players.find((player) => player.slotId === score.slotId)
            ?.index ?? 0) +
            1) +
          " · " +
          score.score +
          " 胜",
      ),
      view.outcome.reason === "RESIGNATION"
        ? "本场因投降结束"
        : "率先赢下 3 小局",
    ],
  };
}
export function shouldInterpolate(
  previous: PlayView | null,
  current: PlayView,
  reset: boolean,
): boolean {
  return (
    !reset &&
    previous !== null &&
    previous.bout === current.bout &&
    previous.phase === "ACTIVE" &&
    current.phase === "ACTIVE" &&
    previous.arena.cols === current.arena.cols &&
    previous.arena.rows === current.arena.rows
  );
}
export function setupNotice(status: string, code?: string): string {
  if (status === "accepted") return "设置已确认，请所有玩家重新准备。";
  if (status === "stale") return "设置已被更新，请查看最新人数后重新选择。";
  if (code === "NOT_OWNER") return "只有房主可以修改人数。";
  if (code === "SETUP_UNCHANGED") return "当前已经是这个人数。";
  if (code === "PLAYERS_NOT_READY") return "请等待人数到齐并重新准备。";
  return "设置未保存，请检查连接后重试。";
}
