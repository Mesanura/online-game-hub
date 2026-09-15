import type { PlayIntent, PlayView } from "./contracts";
export const colors = ["#79ebd7", "#ffbd70", "#c9a2ff", "#ff7899"] as const;
export function actionKey(code: string): PlayIntent | null {
  if (code === "Space") return { type: "JUMP" };
  if (code === "KeyJ") return { type: "ATTACK" };
  if (["KeyK", "ShiftLeft", "ShiftRight"].includes(code))
    return { type: "SLIDE" };
  return null;
}
export function movement(
  keys: ReadonlySet<string>,
  touch: ReadonlyMap<number, -1 | 1>,
): -1 | 0 | 1 {
  const left =
    keys.has("KeyA") ||
    keys.has("ArrowLeft") ||
    [...touch.values()].includes(-1);
  const right =
    keys.has("KeyD") ||
    keys.has("ArrowRight") ||
    [...touch.values()].includes(1);
  return left === right ? 0 : left ? -1 : 1;
}
export function summary(view: PlayView) {
  if (!view.outcome) return null;
  const winner = view.players.find(
    (p) => p.slotId === view.outcome?.winnerSlotId,
  );
  return {
    headline: winner ? "P" + (winner.index + 1) + " 赢下本场" : "本场平局",
    details: view.players.map(
      (p) =>
        "P" +
        (p.index + 1) +
        " · " +
        p.score +
        " 分" +
        (p.resigned ? " · 已投降" : ""),
    ),
    tone:
      view.outcome.type === "DRAW"
        ? ("neutral" as const)
        : view.outcome.winnerSlotId === view.selfSlotId
          ? ("win" as const)
          : ("neutral" as const),
  };
}
export class EffectFeed {
  private latestId = 0;
  observe(view: PlayView, reset: boolean) {
    if (reset) {
      this.latestId = Math.max(0, ...view.effects.map((e) => e.id));
      return [];
    }
    const fresh = view.effects.filter(
      (e) => e.id > this.latestId && e.until > view.tick,
    );
    this.latestId = Math.max(this.latestId, ...view.effects.map((e) => e.id));
    return fresh;
  }
}
