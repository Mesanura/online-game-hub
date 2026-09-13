import Phaser from "phaser";
import type { PlayView, Point } from "./contracts";
import {
  CANVAS,
  EFFECT_LIFETIME,
  railOrigin,
  railPoint,
  toScreen,
  type VisualImpact,
} from "./model";

export type RenderState = {
  current: PlayView;
  previous: PlayView | null;
  receivedAt: number;
  reducedMotion: boolean;
  impacts: readonly VisualImpact[];
};
const COLORS = [0x3b82f6, 0xf59e0b] as const;

export class AirHockeyScene extends Phaser.Scene {
  readonly #read: () => RenderState | null;
  #field: Phaser.GameObjects.Graphics | null = null;
  #pieces: Phaser.GameObjects.Graphics | null = null;
  #effects: Phaser.GameObjects.Graphics | null = null;
  #side: number | null = null;
  constructor(read: () => RenderState | null) {
    super({ key: "air-hockey" });
    this.#read = read;
  }
  create(): void {
    this.#field = this.add.graphics();
    this.#effects = this.add.graphics();
    this.#pieces = this.add.graphics();
  }
  override update(): void {
    const render = this.#read();
    if (
      render === null ||
      this.#field === null ||
      this.#pieces === null ||
      this.#effects === null
    )
      return;
    const { current, previous } = render;
    if (this.#side !== current.yourSide) {
      this.#drawField(current);
      this.#side = current.yourSide;
    }
    const now = performance.now();
    const alpha =
      render.reducedMotion || previous === null
        ? 1
        : Math.max(0, Math.min(1, (now - render.receivedAt) / (1000 / 60)));
    const position = (point: Point, before: Point | undefined) =>
      toScreen(
        {
          x:
            (before?.x ?? point.x) + (point.x - (before?.x ?? point.x)) * alpha,
          y:
            (before?.y ?? point.y) + (point.y - (before?.y ?? point.y)) * alpha,
        },
        current.yourSide,
      );
    const graphics = this.#pieces;
    graphics.clear();
    for (const side of [0, 1] as const) {
      const point = position(current.paddles[side], previous?.paddles[side]);
      const radius = current.field.paddleRadius / 1000;
      graphics.fillStyle(COLORS[side], 0.08);
      graphics.fillCircle(point.x, point.y, radius + 7);
      graphics.fillStyle(COLORS[side], 1);
      graphics.fillCircle(point.x, point.y, radius);
      graphics.lineStyle(1.5, 0xffffff, 0.12);
      graphics.strokeCircle(point.x, point.y, radius - 0.75);
      graphics.fillStyle(0xffffff, 0.27);
      graphics.fillCircle(point.x, point.y, radius * 0.4);
    }
    const puck = position(current.puck, previous?.puck);
    graphics.fillStyle(0xf1f5f9, 0.1);
    graphics.fillCircle(puck.x, puck.y, current.field.puckRadius / 1000 + 3);
    graphics.fillStyle(0xf1f5f9, 1);
    graphics.fillCircle(puck.x, puck.y, current.field.puckRadius / 1000);
    this.#drawImpacts(render, now);
  }
  #drawField(view: PlayView): void {
    const graphics = this.#field;
    if (graphics === null) return;
    const { padding: p, courtWidth: w, courtHeight: h } = CANVAS;
    graphics.clear();
    graphics.fillStyle(0x0b1020, 1);
    graphics.fillRoundedRect(p, p, w, h, 18);
    graphics.lineStyle(1.25, 0x334155, 1);
    graphics.strokeRoundedRect(p, p, w, h, 18);
    graphics.lineStyle(4, 0x778397, 0.32);
    graphics.strokeCircle(p + w / 2, p + h / 2, view.field.centerRadius / 1000);
    for (let x = p; x < p + w; x += 21)
      graphics.lineBetween(x, p + h / 2, Math.min(x + 9, p + w), p + h / 2);
    for (const side of [0, 1] as const) {
      const y = side === view.yourSide ? p + h - 2 : p + 2;
      graphics.lineStyle(8, COLORS[side], 0.12);
      graphics.lineBetween(
        p + view.field.goalLeft / 1000,
        y,
        p + view.field.goalRight / 1000,
        y,
      );
      graphics.lineStyle(3.5, COLORS[side], 1);
      graphics.lineBetween(
        p + view.field.goalLeft / 1000,
        y,
        p + view.field.goalRight / 1000,
        y,
      );
    }
  }
  #drawImpacts(render: RenderState, now: number): void {
    const graphics = this.#effects;
    if (graphics === null) return;
    graphics.clear();
    for (const { event, startedAt } of render.impacts) {
      const age = now - startedAt;
      if (age < 0 || age >= EFFECT_LIFETIME) continue;
      const progress = age / EFFECT_LIFETIME;
      const point = toScreen(event, render.current.yourSide);
      if (event.kind === "GOAL") {
        graphics.lineStyle(
          8,
          event.side === null ? 0xf1f5f9 : COLORS[event.side],
          (1 - progress) * 0.7,
        );
        const left = toScreen(
          { x: render.current.field.goalLeft, y: event.y },
          render.current.yourSide,
        );
        const right = toScreen(
          { x: render.current.field.goalRight, y: event.y },
          render.current.yourSide,
        );
        graphics.lineBetween(left.x, left.y, right.x, right.y);
        continue;
      }
      if (event.kind !== "WALL") continue;
      if (render.reducedMotion) {
        if (age < 140) {
          graphics.fillStyle(0xb9defd, 0.65);
          graphics.fillCircle(point.x, point.y, 6);
        }
        continue;
      }
      const { distance, right } = railOrigin(event);
      const travel = progress * (160 + event.strength * 0.2);
      const tail = Math.max(0, travel - 52);
      for (const direction of [-1, 1]) {
        const points: Point[] = [];
        for (let d = tail; d <= travel + 4; d += 4)
          points.push(
            toScreen(
              railPoint(distance + direction * Math.min(travel, d), right),
              render.current.yourSide,
            ),
          );
        for (const [width, opacity] of [
          [8, 0.1],
          [2, 0.8],
        ] as const) {
          graphics.lineStyle(
            width,
            0xb9defd,
            opacity * (1 - progress) * (0.35 + event.strength / 1500),
          );
          graphics.beginPath();
          points.forEach((sample, i) => {
            if (i === 0) graphics.moveTo(sample.x, sample.y);
            else graphics.lineTo(sample.x, sample.y);
          });
          graphics.strokePath();
        }
      }
    }
  }
}
