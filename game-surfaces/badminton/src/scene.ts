import Phaser from "phaser";
import type { PlayView } from "./contracts";
import { interpolationAlpha, lerp } from "./model";
import {
  playerPose,
  projectPoint,
  shuttlePosition,
  ShuttleTrail,
  SoundTimeline,
  type Point,
  type SoundCue,
} from "./presentation";

export interface RenderState {
  current: PlayView;
  previous: PlayView | null;
  receivedAt: number;
  reducedMotion: boolean;
  epoch: number;
  active: boolean;
  gameVersion: string;
  audioReady: boolean;
  playSound: (cue: SoundCue) => void;
}

const INK = 0x243f49;
const BLUE = 0x467faa;
const CORAL = 0xdd8066;

export class BadmintonScene extends Phaser.Scene {
  readonly #getState: () => RenderState | null;
  #graphics: Phaser.GameObjects.Graphics | null = null;
  #you: Phaser.GameObjects.Text | null = null;
  #banner: Phaser.GameObjects.Text | null = null;
  #trail = new ShuttleTrail();
  #sounds = new SoundTimeline();
  #court: Phaser.GameObjects.Graphics | null = null;
  #courtKey = "";
  #youSide: string | null = null;

  constructor(getState: () => RenderState | null) {
    super({ key: "badminton" });
    this.#getState = getState;
  }

  create(): void {
    this.drawBackground();
    this.#court = this.add.graphics();
    this.#graphics = this.add.graphics();
    this.#you = this.add
      .text(240, 352, "你", {
        color: "#ffffff",
        backgroundColor: "#467faa",
        fontFamily: "system-ui, sans-serif",
        fontSize: "18px",
        fontStyle: "bold",
        padding: { x: 10, y: 3 },
      })
      .setOrigin(0.5);
    this.#banner = this.add
      .text(500, 114, "", {
        color: "#31545a",
        backgroundColor: "#fff9e8",
        fontFamily: "system-ui, sans-serif",
        fontSize: "24px",
        fontStyle: "bold",
        padding: { x: 20, y: 12 },
        align: "center",
      })
      .setOrigin(0.5);
  }

  private drawBackground(): void {
    const g = this.add.graphics();
    g.fillGradientStyle(0xe5f2ec, 0xe5f2ec, 0xf8f1de, 0xf8f1de, 1);
    g.fillRect(0, 0, 1000, 600);
    g.fillStyle(0xf6d994, 0.75);
    g.fillCircle(846, 92, 43);
    g.fillStyle(0xffffff, 0.65);
    for (const [x, y, scale] of [
      [125, 115, 1],
      [655, 64, 0.7],
      [930, 192, 0.6],
    ]) {
      if (x === undefined || y === undefined || scale === undefined) continue;
      g.fillEllipse(x, y, 120 * scale, 30 * scale);
      g.fillEllipse(x - 22 * scale, y - 9 * scale, 53 * scale, 38 * scale);
      g.fillEllipse(x + 14 * scale, y - 15 * scale, 65 * scale, 43 * scale);
    }
    g.fillStyle(0xccddd0, 0.58);
    g.fillEllipse(160, 422, 670, 215);
    g.fillEllipse(800, 420, 640, 240);
    g.fillStyle(0xb6cec1, 0.52);
    g.fillEllipse(440, 490, 650, 218);
    // Original, deliberately simple park silhouettes keep the shuttle legible.
    for (const x of [18, 68, 944, 990]) {
      g.lineStyle(7, 0xa6bfb0, 0.65);
      g.lineBetween(x, 310, x, 462);
      g.fillStyle(0x9fbfb0, 0.6);
      g.fillEllipse(x, 302, 79, 118);
    }
    g.lineStyle(2, 0xb0c1b4, 0.75);
    for (let x = 30; x < 1000; x += 50) g.lineBetween(x, 417, x, 465);
    g.lineBetween(0, 424, 1000, 424);
    g.lineBetween(0, 451, 1000, 451);
    g.fillStyle(0xe5deca);
    g.fillRect(0, 464, 1000, 136);
    g.fillStyle(0x244d4d, 0.12);
    g.fillEllipse(500, 583, 840, 13);
    this.add
      .text(500, 33, "S H U T T L E   C L U B", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        fontStyle: "bold",
        color: "#6e8d84",
      })
      .setOrigin(0.5);
    this.add
      .text(55, 570, "01", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        fontStyle: "bold",
        color: "#ecf1da",
      })
      .setOrigin(0.5);
    this.add
      .text(945, 570, "02", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        fontStyle: "bold",
        color: "#ecf1da",
      })
      .setOrigin(0.5);
  }

  override update(): void {
    const render = this.#getState();
    const g = this.#graphics;
    if (render === null || g === null) return;
    const view = render.current;
    const previous = render.previous ?? view;
    const alpha = interpolationAlpha(
      render.previous,
      view,
      performance.now() - render.receivedAt,
      render.reducedMotion,
    );
    const world = shuttlePosition(previous, view, alpha);
    const { x, y } = projectPoint(world.x, world.y);
    const renderTick = lerp(previous.tick, view.tick, alpha);
    const identity = `${render.epoch}:${view.rally}`;
    const fresh = performance.now() - render.receivedAt < 250;
    for (const cue of this.#sounds.consume(
      view,
      renderTick,
      identity,
      render.active && render.audioReady && fresh,
    ))
      render.playSound(cue);
    this.drawCourt(view);
    g.clear();
    this.drawNet(g, view, false);
    g.fillStyle(0x284e4a, 0.12);
    g.fillEllipse(
      x,
      543,
      Math.max(8, 23 - (view.court.ground - world.y) / 25000),
      5,
    );
    for (const side of [0, 1] as const) {
      const current = view.athletes[side];
      const older = previous.athletes[side];
      const px = lerp(older.x, current.x, alpha);
      const py = lerp(older.y, current.y, alpha);
      this.drawPlayer(g, view, px, py, side, renderTick, render.reducedMotion);
      if (view.yourSide === (side === 0 ? "LEFT" : "RIGHT")) {
        if (this.#youSide !== view.yourSide) {
          this.#youSide = view.yourSide;
          this.#you?.setBackgroundColor(side === 0 ? "#467faa" : "#ca715a");
        }
        this.#you
          ?.setPosition(projectPoint(px, py).x, projectPoint(px, py).y - 150)
          .setVisible(true);
      }
    }
    if (view.yourSide === null) this.#you?.setVisible(false);
    const now = performance.now();
    for (const point of this.#trail.update(
      { x, y },
      now,
      view.phase === "RALLY" && !render.reducedMotion && render.active && fresh,
      identity,
    )) {
      const life = 1 - (now - point.born) / 420;
      const drift = Math.sin(point.born * 0.17) * 5;
      g.fillStyle(0xc5a52a, life * 0.9);
      g.fillEllipse(point.x + drift, point.y + (1 - life) * 7, 5, 8);
      g.fillStyle(0xf4ff58, life);
      g.fillEllipse(point.x + drift, point.y + (1 - life) * 7 - 1, 3, 6);
    }
    const angle =
      view.phase !== "RALLY"
        ? 0.2
        : Math.atan2(
            view.shuttle.y - previous.shuttle.y,
            view.shuttle.x - previous.shuttle.x,
          );
    this.drawShuttle(g, x, y, angle);
    this.drawNet(g, view, true);
    if (view.phase === "POINT" && view.lastPoint !== null) {
      const point = view.lastPoint;
      g.lineStyle(3, point.winner === 0 ? BLUE : CORAL, 0.65);
      const projected = projectPoint(
        point.x,
        Math.min(view.court.ground, point.y),
      );
      g.strokeEllipse(projected.x, projected.y, 28, 10);
    }
    const banner =
      view.phase === "SERVE"
        ? `${view.servingSide === view.yourSide ? "你的" : "对手的"}发球${render.gameVersion === "1.0.0" ? `  ${Math.ceil(view.phaseTicks / 60)}` : ""}`
        : view.phase === "POINT"
          ? "+ 1"
          : "";
    this.#banner?.setText(banner).setVisible(banner.length > 0);
  }

  private line(
    g: Phaser.GameObjects.Graphics,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: number,
  ): void {
    g.lineStyle(width, color);
    g.lineBetween(x1, y1, x2, y2);
    g.fillStyle(color);
    g.fillCircle(x1, y1, width / 2);
    g.fillCircle(x2, y2, width / 2);
  }

  private drawPlayer(
    g: Phaser.GameObjects.Graphics,
    view: PlayView,
    x: number,
    y: number,
    side: 0 | 1,
    tick: number,
    reducedMotion: boolean,
  ): void {
    const pose = playerPose(view, side, x, y, tick, reducedMotion);
    const { facing } = pose;
    const color = side === 0 ? BLUE : CORAL;
    const line = (a: Point, b: Point, width = 6, ink = INK) =>
      this.line(g, a.x, a.y, b.x, b.y, width, ink);
    const center = projectPoint(x, y);
    g.fillStyle(0x254c46, 0.15);
    g.fillEllipse(
      center.x,
      543,
      Math.max(18, 42 - (view.court.ground - y) / 12000),
      8,
    );
    line(pose.hip, pose.frontKnee, 7);
    line(pose.frontKnee, pose.frontHeel, 7);
    line(pose.hip, pose.backKnee, 7);
    line(pose.backKnee, pose.backHeel, 7);
    line(pose.frontHeel, pose.front, 6, color);
    line(pose.backHeel, pose.back, 6, color);
    line(pose.hip, pose.shoulder, 8);
    line(
      { x: center.x, y: center.y - 80 },
      { x: center.x, y: center.y - 63 },
      12,
      color,
    );
    line(pose.shoulder, pose.freeElbow);
    line(pose.freeElbow, pose.freeHand);
    line(pose.shoulder, pose.elbow);
    line(pose.elbow, pose.hand);
    if (pose.swing && !reducedMotion) {
      const older = playerPose(view, side, x, y, Math.max(0, tick - 1.8), true);
      g.lineStyle(2, color, 0.15);
      g.lineBetween(
        older.racket.x,
        older.racket.y,
        pose.racket.x,
        pose.racket.y,
      );
    }
    line(pose.hand, pose.racket, 3, color);
    g.save();
    g.translateCanvas(pose.racket.x, pose.racket.y);
    g.rotateCanvas(pose.racketAngle);
    g.fillStyle(0xfffcf0, 0.35);
    g.fillEllipse(0, 0, 50, 24);
    g.lineStyle(2.5, color);
    g.strokeEllipse(0, 0, 50, 24);
    g.lineStyle(0.8, color, 0.45);
    for (const offset of [-6, 0, 6]) {
      g.lineBetween(-21, offset, 21, offset);
      g.lineBetween(offset, -8, offset, 8);
    }
    g.restore();
    g.fillStyle(INK);
    g.fillCircle(pose.head.x, pose.head.y, 15);
    g.fillStyle(0xfff8df);
    g.fillCircle(pose.head.x, pose.head.y - 1, 11);
    this.line(
      g,
      pose.head.x - 13,
      pose.head.y - 6,
      pose.head.x + 13,
      pose.head.y - 6,
      5,
      color,
    );
    this.line(
      g,
      pose.head.x - facing * 13,
      pose.head.y - 6,
      pose.head.x - facing * 23,
      pose.head.y - 2,
      3,
      color,
    );
    g.fillStyle(INK);
    g.fillCircle(pose.head.x + facing * 6, pose.head.y + 1, 2.3);
  }

  private drawCourt(view: PlayView): void {
    const g = this.#court;
    if (g === null) return;
    const key = JSON.stringify(view.court);
    if (key === this.#courtKey) return;
    this.#courtKey = key;
    g.clear();
    const { leftLine, rightLine, ground, netX, leftServeLine, rightServeLine } =
      view.court;
    const p = (x: number, d: number) => projectPoint(x, ground, d);
    const corners = [
      p(leftLine, 0),
      p(rightLine, 0),
      p(rightLine, 1),
      p(leftLine, 1),
    ];
    g.fillStyle(0x87b6a8);
    g.fillPoints(corners, true);
    g.fillStyle(0x71a494);
    g.fillPoints(
      [p(leftLine, 0), p(netX, 0), p(netX, 1), p(leftLine, 1)],
      true,
    );
    g.lineStyle(2.5, 0xf4f5df, 0.95);
    g.strokePoints(corners, true);
    const segment = (a: Point, b: Point) => g.lineBetween(a.x, a.y, b.x, b.y);
    for (const x of [leftServeLine, netX, rightServeLine])
      segment(p(x, 0), p(x, 1));
    segment(p(leftLine, 0.5), p(rightLine, 0.5));
    g.lineStyle(4, 0x3f786e);
    segment(p(leftLine, 0), p(rightLine, 0));
  }

  private drawNet(
    g: Phaser.GameObjects.Graphics,
    view: PlayView,
    front: boolean,
  ): void {
    const { netX, netTop, ground } = view.court;
    const p = (y: number, d: number) => projectPoint(netX, y, d);
    const d0 = front ? 0.5 : 0,
      d1 = front ? 1 : 0.5;
    const top0 = p(netTop, d0),
      top1 = p(netTop, d1);
    const bottom0 = p(netTop + 85_000, d0),
      bottom1 = p(netTop + 85_000, d1);
    g.fillStyle(0x325e58, 0.075);
    g.fillPoints([top0, top1, bottom1, bottom0], true);
    g.lineStyle(1, 0x456d63, 0.6);
    for (let i = 0; i <= 5; i++) {
      const d = lerp(d0, d1, i / 5);
      const a = p(netTop, d),
        b = p(netTop + 85_000, d);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let y = netTop + 10_000; y < netTop + 85_000; y += 10_000) {
      const a = p(y, d0),
        b = p(y, d1);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    this.line(g, top0.x, top0.y, top1.x, top1.y, 5, 0xfffdf2);
    this.line(g, bottom0.x, bottom0.y, bottom1.x, bottom1.y, 2, 0xecede2);
    const d = front ? 1 : 0,
      top = p(netTop, d),
      foot = p(ground, d);
    g.fillStyle(0x224d46, 0.14);
    g.fillEllipse(foot.x + 3, foot.y + 2, 18, 6);
    this.line(g, top.x, top.y - 4, foot.x, foot.y, front ? 5 : 4, 0x467982);
    this.line(g, top.x - 1, top.y - 3, foot.x - 1, foot.y, 1.3, 0x9dbfc0);
  }

  private drawShuttle(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    angle: number,
  ): void {
    const backX = x - Math.cos(angle) * 16;
    const backY = y - Math.sin(angle) * 16;
    const acrossX = Math.sin(angle) * 10;
    const acrossY = -Math.cos(angle) * 10;
    g.fillStyle(0xffffff);
    g.fillTriangle(
      x,
      y,
      backX + acrossX,
      backY + acrossY,
      backX - acrossX,
      backY - acrossY,
    );
    g.lineStyle(1.3, 0x819a99);
    g.lineBetween(x, y, backX + acrossX, backY + acrossY);
    g.lineBetween(x, y, backX - acrossX, backY - acrossY);
    g.lineBetween(x, y, backX, backY);
    g.fillStyle(0xe6b95e);
    g.fillCircle(x, y, 6);
    g.lineStyle(1.5, 0x8f783e);
    g.strokeCircle(x, y, 6);
  }
}
