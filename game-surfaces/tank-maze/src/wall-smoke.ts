import type { View } from "./contracts";

type Puff = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  slotId: string;
};
type Frame = Pick<View, "tick" | "phase" | "tanks">;
const lifetime = 700;

/** Short-lived exhaust from authoritative wall contact; no local physics or catch-up. */
export class WallSmoke {
  #puffs: Puff[] = [];
  #lastTick = -1;
  #lastEmission = -Infinity;

  reset() {
    this.#puffs = [];
    this.#lastTick = -1;
    this.#lastEmission = -Infinity;
  }

  update(frame: Frame, now: number, enabled: boolean) {
    if (!enabled || (frame.phase !== "ACTIVE" && frame.phase !== "LAST")) {
      this.reset();
      return;
    }
    this.#puffs = this.#puffs.filter(
      (puff) =>
        now - puff.born < lifetime &&
        frame.tanks.some((tank) => tank.slotId === puff.slotId && tank.alive),
    );
    if (frame.tick <= this.#lastTick) return;
    this.#lastTick = frame.tick;
    if (frame.tick - this.#lastEmission < 3) return;
    this.#lastEmission = frame.tick;
    for (const tank of frame.tanks) {
      if (!tank.alive || !tank.wallContact) continue;
      const angle = (tank.angle * Math.PI) / 360;
      const x = Math.cos(angle),
        y = Math.sin(angle);
      for (const side of [-1, 1]) {
        const spread = side * (0.004 + ((frame.tick + tank.color) % 5) * 0.001);
        this.#puffs.push({
          x: tank.x / 1000 - x * 17 - y * side * 9,
          y: tank.y / 1000 - y * 17 + x * side * 9,
          vx: -x * 0.026 - y * spread,
          vy: -y * 0.026 + x * spread,
          born: now,
          slotId: tank.slotId,
        });
      }
    }
    this.#puffs = this.#puffs.slice(-256);
  }

  sample(now: number) {
    this.#puffs = this.#puffs.filter((puff) => now - puff.born < lifetime);
    return this.#puffs.map((puff) => {
      const age = Math.max(0, now - puff.born);
      return {
        x: puff.x + puff.vx * age,
        y: puff.y + puff.vy * age,
        radius: 3 + (age / lifetime) * 12,
        opacity: 0.6 * (1 - age / lifetime),
      };
    });
  }

  render(now: number) {
    const puffs = this.sample(now);
    if (puffs.length === 0) return "";
    return (
      '<g data-wall-smoke="" aria-hidden="true">' +
      puffs
        .map(
          (puff) =>
            `<circle cx="${puff.x}" cy="${puff.y}" r="${puff.radius}" opacity="${puff.opacity}" fill="url(#wall-smoke)"/>`,
        )
        .join("") +
      "</g>"
    );
  }
}
