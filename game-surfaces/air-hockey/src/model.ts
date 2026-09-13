import type { SurfaceResultSummaryV2 } from "@online-game-hub/game-surface-bridge";
import type { Impact, PlayIntent, PlayView, Point, Side } from "./contracts";

export const CANVAS = {
  width: 624,
  height: 1044,
  padding: 12,
  courtWidth: 600,
  courtHeight: 1020,
} as const;
export const EFFECT_LIFETIME = 450;

export function toScreen(point: Point, side: Side): Point {
  return {
    x: point.x / 1000 + CANVAS.padding,
    y:
      (side === 0 ? point.y / 1000 : CANVAS.courtHeight - point.y / 1000) +
      CANVAS.padding,
  };
}

export function pointerTarget(
  client: Point,
  rect: { left: number; top: number; width: number; height: number },
  clampOutside = false,
): Point | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x =
    ((client.x - rect.left) / rect.width) * CANVAS.width - CANVAS.padding;
  const y =
    ((client.y - rect.top) / rect.height) * CANVAS.height - CANVAS.padding;
  if (
    !clampOutside &&
    (x < 0 || y < 0 || x > CANVAS.courtWidth || y > CANVAS.courtHeight)
  )
    return null;
  return {
    x: Math.round(
      Math.max(0, Math.min(10000, (x / CANVAS.courtWidth) * 10000)),
    ),
    y: Math.round(
      Math.max(0, Math.min(10000, (y / CANVAS.courtHeight) * 10000)),
    ),
  };
}

export class PointerControls {
  #target: Point | null = null;
  #touch: number | null = null;
  #dirty = false;
  #sentAt = -Infinity;
  get active(): boolean {
    return this.#target !== null;
  }
  get touchId(): number | null {
    return this.#touch;
  }
  mouse(point: Point | null): void {
    if (this.#touch !== null) return;
    this.#set(point);
  }
  startTouch(id: number, point: Point | null): boolean {
    if (this.#touch !== null || point === null || point.y < 5000) return false;
    this.#touch = id;
    this.#set(point);
    return true;
  }
  moveTouch(id: number, point: Point | null): void {
    if (id === this.#touch && point !== null) this.#set(point);
  }
  endTouch(id: number): void {
    if (id === this.#touch) this.reset();
  }
  reset(): void {
    this.#touch = null;
    this.#set(null);
  }
  discard(): void {
    this.reset();
    this.#dirty = false;
  }
  take(now: number): PlayIntent | null {
    if (!this.#dirty && (this.#target === null || now - this.#sentAt < 150))
      return null;
    if (this.#target !== null && now - this.#sentAt < 1000 / 60) return null;
    this.#dirty = false;
    this.#sentAt = now;
    return {
      type: "CONTROL",
      target: this.#target === null ? null : { ...this.#target },
    };
  }
  #set(point: Point | null): void {
    const target =
      point === null ? null : { x: point.x, y: Math.max(5000, point.y) };
    if (target?.x === this.#target?.x && target?.y === this.#target?.y) return;
    this.#target = target;
    this.#dirty = true;
  }
}

export function shouldInterpolate(
  previous: PlayView | null,
  current: PlayView,
  reset: boolean,
): boolean {
  return (
    !reset &&
    previous !== null &&
    previous.rally === current.rally &&
    previous.phase === current.phase &&
    previous.yourSide === current.yourSide &&
    current.tick > previous.tick &&
    current.tick - previous.tick <= 12 &&
    current.outcome === null
  );
}

export type VisualImpact = { event: Impact; startedAt: number };
export class ImpactFeed {
  #watermark: number | null = null;
  #visuals: VisualImpact[] = [];
  clear(): void {
    this.#watermark = null;
    this.#visuals = [];
  }
  observe(view: PlayView, now: number, reset = false): Impact[] {
    const maximum = view.events.at(-1)?.id ?? 0;
    if (reset || this.#watermark === null) {
      this.#watermark = maximum;
      this.#visuals = [];
      return [];
    }
    const fresh = view.events.filter(
      (event) =>
        event.id > (this.#watermark ?? 0) && view.tick - event.tick <= 12,
    );
    this.#watermark = Math.max(maximum, this.#watermark);
    this.#visuals.push(
      ...fresh.map((event) => ({
        event,
        startedAt: now - ((view.tick - event.tick - 1) * 1000) / 60,
      })),
    );
    this.#visuals = this.#visuals
      .filter((impact) => now - impact.startedAt < EFFECT_LIFETIME)
      .slice(-12);
    return fresh;
  }
  visuals(now: number): readonly VisualImpact[] {
    this.#visuals = this.#visuals.filter(
      (impact) => now - impact.startedAt < EFFECT_LIFETIME,
    );
    return this.#visuals;
  }
}

const RADIUS = 18;
const HORIZONTAL = 216 - RADIUS;
const ARC = (Math.PI * RADIUS) / 2;
const VERTICAL = CANVAS.courtHeight - RADIUS * 2;
export const RAIL_LENGTH = 2 * HORIZONTAL + 2 * ARC + VERTICAL;

// Each side is one open rail from its top goal post around both rounded
// corners to its bottom post. Clamping stops waves at the goal opening.
export function railPoint(distance: number, right: boolean): Point {
  let d = Math.max(0, Math.min(RAIL_LENGTH, distance));
  let x: number;
  let y: number;
  if (d <= HORIZONTAL) {
    x = 216 - d;
    y = 0;
  } else if ((d -= HORIZONTAL) <= ARC) {
    const angle = -Math.PI / 2 - d / RADIUS;
    x = RADIUS + RADIUS * Math.cos(angle);
    y = RADIUS + RADIUS * Math.sin(angle);
  } else if ((d -= ARC) <= VERTICAL) {
    x = 0;
    y = RADIUS + d;
  } else if ((d -= VERTICAL) <= ARC) {
    const angle = Math.PI - d / RADIUS;
    x = RADIUS + RADIUS * Math.cos(angle);
    y = CANVAS.courtHeight - RADIUS + RADIUS * Math.sin(angle);
  } else {
    d -= ARC;
    x = RADIUS + d;
    y = CANVAS.courtHeight;
  }
  return { x: (right ? CANVAS.courtWidth - x : x) * 1000, y: y * 1000 };
}

export function railOrigin(event: Impact): {
  distance: number;
  right: boolean;
} {
  const right =
    event.edge === "RIGHT" ||
    ((event.edge === "TOP" || event.edge === "BOTTOM") && event.x > 300000);
  const x = right ? CANVAS.courtWidth - event.x / 1000 : event.x / 1000;
  const distance =
    event.edge === "TOP"
      ? 216 - x
      : event.edge === "BOTTOM"
        ? RAIL_LENGTH - (216 - x)
        : HORIZONTAL + ARC + event.y / 1000 - RADIUS;
  return { right, distance: Math.max(0, Math.min(RAIL_LENGTH, distance)) };
}

export function phaseLabel(view: PlayView): string {
  if (view.outcome !== null)
    return view.outcome.winnerSlotId === view.players[view.yourSide].slotId
      ? "你获胜了"
      : "对手获胜";
  if (view.phase === "SERVE")
    return view.server === view.yourSide
      ? "由你开球 · 移动球拍撞击中央白球"
      : "等待对方开球";
  return "守住球门，把球打向对方";
}

export function resultSummary(
  view: PlayView,
): Omit<SurfaceResultSummaryV2, "type" | "stateSequence"> | null {
  if (view.outcome === null) return null;
  const won = view.outcome.winnerSlotId === view.players[view.yourSide].slotId;
  return {
    tone: won ? "win" : "loss",
    headline: won ? "你获胜" : "对手获胜",
    details: [
      `蓝方 ${view.scores[0]} : ${view.scores[1]} 橙方`,
      view.outcome.reason === "RESIGNATION"
        ? "本局因投降结束"
        : `率先得到 ${view.targetScore} 分`,
    ],
  };
}

export function setupNotice(status: string, code?: string): string {
  if (status === "accepted") return "设置已确认，请双方重新准备。";
  if (status === "stale") return "设置已被更新，请根据最新选项重新选择。";
  if (code === "NOT_OWNER") return "只有房主可以修改胜利分数。";
  if (code === "SETUP_UNCHANGED") return "当前已经使用这个分数。";
  if (code === "HOST_REJECTED") return "连接未能确认设置，请检查连接后重试。";
  return "设置未被接受，请检查连接后重试。";
}
