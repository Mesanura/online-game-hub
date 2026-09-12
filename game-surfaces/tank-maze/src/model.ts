import type { View } from "./contracts";
export const COLORS = [
  "#e34b42",
  "#36a65d",
  "#3980d4",
  "#dbac20",
  "#a45ed1",
  "#ee7c32",
  "#2eafbb",
  "#dd65a0",
] as const;
export const COLOR_NAMES = [
  "红",
  "绿",
  "蓝",
  "黄",
  "紫",
  "橙",
  "青",
  "粉",
] as const;
export const WEAPONS = {
  normal: "普通炮",
  laser: "激光",
  missile: "追踪导弹",
  machine: "机枪",
  shotgun: "霰弹枪",
  shield: "护盾",
} as const;
export type Direction = "up" | "down" | "left" | "right";
export const KEYS: Record<string, Direction | "fire"> = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "fire",
};
export class Controls {
  readonly held = new Map<string, Direction>();
  readonly #pointers = new Set<number>();
  press(source: string, control: Direction) {
    this.held.set(source, control);
  }
  release(source: string) {
    this.held.delete(source);
  }
  startPointer(id: number, control: Direction) {
    this.#pointers.add(id);
    this.press(`touch-${id}`, control);
  }
  movePointer(id: number, control: Direction | null): boolean {
    if (!this.#pointers.has(id)) return false;
    if (control === null) this.release(`touch-${id}`);
    else this.press(`touch-${id}`, control);
    return true;
  }
  endPointer(id: number): boolean {
    const tracked = this.#pointers.delete(id);
    this.release(`touch-${id}`);
    return tracked;
  }
  reset() {
    this.held.clear();
    this.#pointers.clear();
  }
  intent() {
    const values = new Set(this.held.values());
    return {
      type: "MOVE" as const,
      move: Number(values.has("up")) - Number(values.has("down")),
      turn: Number(values.has("right")) - Number(values.has("left")),
    };
  }
}
export function summary(v: View) {
  if (v.outcome === null) return null;
  const winner = v.tanks.find((t) => t.slotId === v.outcome?.winnerSlotId);
  return winner === undefined
    ? "本场平局"
    : COLOR_NAMES[winner.color] + "色坦克获胜 · " + winner.score + " 分";
}
export function interpolate(a: number, b: number, alpha: number) {
  return a + (b - a) * Math.max(0, Math.min(1, alpha));
}
