import type { PlayView } from "./contracts";
import { lerp } from "./model";

export interface Point {
  x: number;
  y: number;
}
export function projectPoint(x: number, y: number, depth = 0.5): Point {
  return {
    x:
      500 +
      (x / 1000 - 500) * (0.88 + (depth - 0.5) * 0.24) +
      (depth - 0.5) * 40,
    y: y / 1000 + 41 + (depth - 0.5) * 82,
  };
}

export function shuttlePosition(
  previous: PlayView,
  current: PlayView,
  alpha: number,
): Point {
  const tick = lerp(previous.tick, current.tick, alpha);
  const contact = current.athletes
    .map((p) => p.lastContact)
    .find(
      (c) => c !== null && c.tick > previous.tick && c.tick <= current.tick,
    );
  if (contact !== undefined && contact !== null) {
    if (tick <= contact.tick) {
      const part =
        (tick - previous.tick) / Math.max(1, contact.tick - previous.tick);
      return {
        x: lerp(previous.shuttle.x, contact.x, part),
        y: lerp(previous.shuttle.y, contact.y, part),
      };
    }
    const part =
      (tick - contact.tick) / Math.max(1, current.tick - contact.tick);
    return {
      x: lerp(contact.x, current.shuttle.x, part),
      y: lerp(contact.y, current.shuttle.y, part),
    };
  }
  return {
    x: lerp(previous.shuttle.x, current.shuttle.x, alpha),
    y: lerp(previous.shuttle.y, current.shuttle.y, alpha),
  };
}

export function playerPose(
  view: PlayView,
  side: 0 | 1,
  x: number,
  y: number,
  tick: number,
  reducedMotion: boolean,
) {
  const athlete = view.athletes[side];
  const facing = side === 0 ? 1 : -1;
  const holding =
    view.servingSide === (side === 0 ? "LEFT" : "RIGHT") &&
    ["SERVE", "SERVING"].includes(view.phase);
  const limit =
    side === 0 ? view.court.leftServeLine : view.court.rightServeLine;
  const distance = holding
    ? Math.max(
        0,
        (facing * (limit - x)) / 1000 - view.court.frontFootOffset / 1000,
      )
    : 20;
  const stride =
    reducedMotion || !athlete.moving
      ? 0
      : Math.sin(tick * 0.5) * 7 * Math.min(1, distance / 12);
  const airborne = y < view.court.ground - 1000;
  const front = {
    x: view.court.frontFootOffset / 1000 + stride,
    y: airborne ? -9 : 0,
  };
  const back = { x: -16 - stride, y: airborne ? -17 : 0 };
  const shoulder = { x: 0, y: -90 };
  const start = athlete.swingStartedTick;
  const age = start === null ? 100 : Math.max(0, tick - start);
  const duration = athlete.swingKind === "SERVE" ? 18 : 10;
  const playing = start !== null && age < duration + 7;
  const readyAngle = -2.3;
  let angle = holding && view.phase === "SERVE" ? 2.35 : readyAngle;
  if (playing) {
    const contactAge = athlete.swingKind === "SERVE" ? 5 : 4;
    const progress = Math.min(1, age / duration);
    angle =
      athlete.swingKind === "OVERHEAD"
        ? lerp(-2.3, 0.1, progress)
        : age <= contactAge
          ? lerp(2.35, 0.77, age / contactAge)
          : lerp(0.77, -1.1, (age - contactAge) / (duration - contactAge));
    if (age > duration)
      angle = lerp(angle, readyAngle, Math.min(1, (age - duration) / 7));
  }
  let racket = {
    x: Math.cos(angle) * 108,
    y: shoulder.y + Math.sin(angle) * 108,
  };
  const contact = athlete.lastContact;
  if (contact !== null && start !== null && contact.tick >= start) {
    const blend = Math.max(0, 1 - Math.abs(tick - contact.tick) / 3);
    racket = {
      x: lerp(racket.x, (facing * (contact.x - x)) / 1000, blend),
      y: lerp(racket.y, (contact.y - y) / 1000, blend),
    };
  }
  const length = Math.max(1, Math.hypot(racket.x, racket.y - shoulder.y));
  const ux = racket.x / length;
  const uy = (racket.y - shoulder.y) / length;
  const hand = { x: racket.x - ux * 52, y: racket.y - uy * 52 };
  const elbow = holding
    ? {
        x: shoulder.x + (hand.x - shoulder.x) * 0.52,
        y: shoulder.y + (hand.y - shoulder.y) * 0.52,
      }
    : {
        x: hand.x * 0.53 - uy * 8,
        y: lerp(shoulder.y, hand.y, 0.53) + ux * 8,
      };
  const freeHand = holding ? { x: 40, y: -70 } : { x: 24, y: -104 };
  const point = (p: Point): Point =>
    projectPoint(x + facing * p.x * 1000, y + p.y * 1000);
  return {
    front: point(front),
    back: point(back),
    frontHeel: point({ x: front.x - 8, y: front.y }),
    backHeel: point({ x: back.x + 8, y: back.y }),
    hip: point({ x: 0, y: -52 }),
    frontKnee: point({ x: 11 + stride / 2, y: -26 }),
    backKnee: point({ x: (back.x + 8) / 2, y: (-52 + back.y) / 2 }),
    shoulder: point(shoulder),
    head: point({ x: -1, y: -113 }),
    hand: point(hand),
    elbow: point(elbow),
    freeHand: point(freeHand),
    freeElbow: point(holding ? { x: 26, y: -80 } : { x: 15, y: -86 }),
    racket: point(racket),
    racketAngle: Math.atan2(uy, facing * ux * 0.88),
    swing: playing,
    holding,
    facing,
  };
}

export class ShuttleTrail {
  #points: (Point & { born: number })[] = [];
  #identity = "";
  #lastEmission = -Infinity;
  update(
    point: Point,
    now: number,
    active: boolean,
    identity: string,
  ): readonly (Point & { born: number })[] {
    if (identity !== this.#identity || !active) {
      this.#points = [];
      this.#lastEmission = -Infinity;
      this.#identity = identity;
    }
    while (this.#points[0] !== undefined && now - this.#points[0].born >= 420)
      this.#points.shift();
    const previous = this.#points.at(-1);
    if (
      active &&
      now - this.#lastEmission >= 75 &&
      (previous === undefined ||
        Math.hypot(point.x - previous.x, point.y - previous.y) >= 16)
    ) {
      this.#points.push({ ...point, born: now });
      if (this.#points.length > 8) this.#points.shift();
      this.#lastEmission = now;
    }
    return this.#points;
  }
}

export interface SoundCue {
  kind: "swing" | "hit";
  tick: number;
  smash: boolean;
}
export class SoundTimeline {
  #identity: string | null = null;
  #seen: (number | null)[] = [];
  #pending: SoundCue[] = [];
  consume(
    view: PlayView,
    renderTick: number,
    identity: string,
    active: boolean,
  ): SoundCue[] {
    const keys = view.athletes.flatMap((p) => [
      p.swingStartedTick,
      p.lastContact?.tick ?? null,
    ]);
    if (this.#identity !== identity || !active) {
      this.#identity = identity;
      this.#seen = keys;
      this.#pending = [];
      return [];
    }
    view.athletes.forEach((p, side) => {
      if (
        p.swingStartedTick !== null &&
        p.swingStartedTick !== this.#seen[side * 2]
      )
        this.#pending.push({
          kind: "swing",
          tick: p.swingStartedTick,
          smash: p.swingShot === "SMASH",
        });
      if (
        p.lastContact !== null &&
        p.lastContact.tick !== this.#seen[side * 2 + 1]
      )
        this.#pending.push({
          kind: "hit",
          tick: p.lastContact.tick,
          smash: p.lastContact.shot === "SMASH",
        });
    });
    this.#seen = keys;
    const cues = this.#pending
      .filter((c) => c.tick <= renderTick && c.tick >= view.tick - 12)
      .sort((a, b) => a.tick - b.tick);
    this.#pending = this.#pending.filter(
      (c) => c.tick > renderTick && c.tick >= view.tick - 12,
    );
    return cues;
  }
}
