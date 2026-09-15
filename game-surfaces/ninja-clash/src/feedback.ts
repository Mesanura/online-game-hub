import type { Effect } from "./contracts";
type Burst = { effect: Effect; at: number; color: number };
export type Particle = {
  x: number;
  y: number;
  tailX: number;
  tailY: number;
  size: number;
  alpha: number;
  color: number;
};
export type ImpactFrame = {
  kind: "CLASH" | "DEATH";
  x: number;
  y: number;
  alpha: number;
  flash: number;
  radius: number;
  particles: Particle[];
};
export class FeedbackTimeline {
  private bursts: Burst[] = [];
  clear() {
    this.bursts = [];
  }
  add(
    effects: readonly Effect[],
    now: number,
    colorFor: (effect: Effect) => number,
  ) {
    for (const effect of effects)
      if (effect.kind === "CLASH" || effect.kind === "DEATH")
        this.bursts.push({ effect, at: now, color: colorFor(effect) });
    this.bursts = this.bursts.slice(-24);
  }
  frames(now: number, reduced: boolean): ImpactFrame[] {
    this.bursts = this.bursts.filter(
      (b) => now - b.at < (b.effect.kind === "CLASH" ? 450 : 650),
    );
    return this.bursts.map(({ effect, at, color }) => {
      const clash = effect.kind === "CLASH",
        duration = clash ? 450 : 650,
        age = Math.max(0, now - at),
        progress = age / duration,
        t = age / 1000;
      const x = effect.x / 100,
        y = effect.y / 100,
        count = reduced ? 6 : clash ? 24 : 36;
      const particles = Array.from({ length: count }, (_, index) => {
        const seed =
          (Math.imul(effect.id + 1, 1103515245) +
            Math.imul(index + 7, 12345)) >>>
          0;
        const angle = (index / count) * Math.PI * 2 + (seed % 101) / 300;
        const speed = (clash ? 65 : 40) + (seed % 90),
          vx = Math.cos(angle) * speed + (clash ? 0 : effect.facing * 25),
          vy = Math.sin(angle) * speed;
        const travel = reduced ? 0.04 : t;
        const px = x + vx * travel,
          py = y + vy * travel + (clash ? 30 : 95) * travel * travel;
        return {
          x: px,
          y: py,
          tailX: px - (reduced ? 0 : vx * 0.022),
          tailY: py - (reduced ? 0 : vy * 0.022),
          size: clash ? 1 : 2 + (seed % 3),
          alpha: Math.max(0, 1 - progress),
          color: clash
            ? index % 3 === 0
              ? 0xffffff
              : 0xffcf71
            : index % 4 === 0
              ? 0xffffff
              : color,
        };
      });
      return {
        kind: clash ? "CLASH" : "DEATH",
        x,
        y,
        alpha: 1 - progress,
        flash: reduced ? 0 : Math.max(0, 1 - age / 90),
        radius: reduced ? 10 : 5 + progress * (clash ? 35 : 22),
        particles,
      };
    });
  }
}
