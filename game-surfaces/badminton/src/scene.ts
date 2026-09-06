import Phaser from "phaser";
import type { PlayView } from "./contracts";
import { interpolationAlpha, lerp } from "./model";

export interface RenderState {
  current: PlayView;
  previous: PlayView | null;
  receivedAt: number;
  reducedMotion: boolean;
}

const INK = 0x243f49;
const BLUE = 0x467faa;
const CORAL = 0xdd8066;

export class BadmintonScene extends Phaser.Scene {
  readonly #getState: () => RenderState | null;
  #graphics: Phaser.GameObjects.Graphics | null = null;
  #you: Phaser.GameObjects.Text | null = null;
  #banner: Phaser.GameObjects.Text | null = null;
  #trail: { x: number; y: number }[] = [];
  #lastTick = -1;
  #lastRally = -1;

  constructor(getState: () => RenderState | null) {
    super({ key: "badminton" });
    this.#getState = getState;
  }

  create(): void {
    this.drawBackground();
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
    g.fillStyle(0x87b6a8);
    g.fillPoints(
      [
        { x: 80, y: 500 },
        { x: 920, y: 500 },
        { x: 983, y: 582 },
        { x: 17, y: 582 },
      ],
      true,
    );
    g.fillStyle(0x71a494);
    g.fillPoints(
      [
        { x: 80, y: 500 },
        { x: 500, y: 500 },
        { x: 500, y: 582 },
        { x: 17, y: 582 },
      ],
      true,
    );
    g.lineStyle(3, 0xf4f5df, 0.9);
    g.strokePoints(
      [
        { x: 80, y: 500 },
        { x: 920, y: 500 },
        { x: 983, y: 582 },
        { x: 17, y: 582 },
      ],
      true,
    );
    g.lineBetween(500, 500, 500, 582);
    g.lineBetween(50, 539, 949, 539);
    g.lineBetween(265, 500, 240, 582);
    g.lineBetween(735, 500, 760, 582);
    g.lineStyle(5, 0x3f786e);
    g.lineBetween(79, 501, 921, 501);
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
    const x = lerp(previous.shuttle.x, view.shuttle.x, alpha) / 1000;
    const y = lerp(previous.shuttle.y, view.shuttle.y, alpha) / 1000;
    if (
      view.rally !== this.#lastRally ||
      view.phase !== "RALLY" ||
      render.reducedMotion
    )
      this.#trail = [];
    if (view.tick !== this.#lastTick && view.phase === "RALLY") {
      this.#trail.push({ x, y });
      if (this.#trail.length > 5) this.#trail.shift();
    }
    this.#lastTick = view.tick;
    this.#lastRally = view.rally;
    g.clear();
    g.fillStyle(0x284e4a, 0.12);
    g.fillEllipse(x, 511, Math.max(10, 27 - (500 - y) / 25), 6);
    for (const side of [0, 1] as const) {
      const current = view.athletes[side];
      const older = previous.athletes[side];
      const px = lerp(older.x, current.x, alpha) / 1000;
      const py = lerp(older.y, current.y, alpha) / 1000;
      const gait =
        render.reducedMotion || !current.moving
          ? 0
          : Math.sin(performance.now() / 72) * 11;
      this.drawPlayer(g, px, py, side, current, gait);
      if (view.yourSide === (side === 0 ? "LEFT" : "RIGHT")) {
        this.#you
          ?.setPosition(px, py - 137)
          .setBackgroundColor(side === 0 ? "#467faa" : "#ca715a")
          .setVisible(true);
      }
    }
    if (view.yourSide === null) this.#you?.setVisible(false);
    this.drawNet(g);
    if (!render.reducedMotion)
      this.#trail.forEach((point, index) => {
        g.fillStyle(0xffffff, (index + 1) * 0.1);
        g.fillCircle(point.x, point.y, 3 + index);
      });
    const angle =
      view.phase !== "RALLY"
        ? 0.2
        : Math.atan2(
            view.shuttle.y - previous.shuttle.y,
            view.shuttle.x - previous.shuttle.x,
          );
    this.drawShuttle(g, x, y, angle);
    if (view.phase === "POINT" && view.lastPoint !== null) {
      const point = view.lastPoint;
      g.lineStyle(3, point.winner === 0 ? BLUE : CORAL, 0.65);
      g.strokeEllipse(point.x / 1000, Math.min(500, point.y / 1000), 34, 13);
    }
    const banner =
      view.phase === "SERVE"
        ? `${view.servingSide === view.yourSide ? "你的" : "对手的"}发球  ${Math.ceil(view.phaseTicks / 60)}`
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
    x: number,
    y: number,
    side: 0 | 1,
    athlete: PlayView["athletes"][number],
    gait: number,
  ): void {
    const facing = side === 0 ? 1 : -1;
    const color = side === 0 ? BLUE : CORAL;
    const jumping = y < 499;
    const spread = jumping ? 17 : 13;
    g.fillStyle(0x254c46, 0.15);
    g.fillEllipse(x, 505, 48 - (500 - y) / 9, 10);
    this.line(g, x, y - 47, x - spread + gait, y - (jumping ? 18 : 5), 7, INK);
    this.line(g, x, y - 47, x + spread - gait, y - (jumping ? 11 : 5), 7, INK);
    this.line(
      g,
      x - spread + gait,
      y - (jumping ? 18 : 5),
      x - spread + gait + facing * 9,
      y - (jumping ? 18 : 5),
      7,
      color,
    );
    this.line(
      g,
      x + spread - gait,
      y - (jumping ? 11 : 5),
      x + spread - gait + facing * 9,
      y - (jumping ? 11 : 5),
      7,
      color,
    );
    this.line(g, x, y - 81, x, y - 45, 9, INK);
    this.line(g, x, y - 80, x, y - 64, 14, color);
    this.line(
      g,
      x - facing * 2,
      y - 78,
      x - facing * 22,
      y - 57 - gait / 2,
      6,
      INK,
    );
    const swing = athlete.swingTicks > 0;
    const angle = swing ? -1.8 + ((10 - athlete.swingTicks) / 10) * 2.8 : -0.6;
    const handX = x + facing * (18 + Math.cos(angle) * 20);
    const handY = y - 80 + Math.sin(angle) * 24;
    this.line(g, x, y - 78, handX, handY, 6, INK);
    const racketX = handX + facing * Math.cos(angle) * 29;
    const racketY = handY + Math.sin(angle) * 29;
    this.line(g, handX, handY, racketX, racketY, 4, color);
    if (swing) {
      g.lineStyle(3, color, 0.22);
      g.beginPath();
      g.arc(
        x + facing * 18,
        y - 80,
        69,
        facing === 1 ? -1.5 : 1.7,
        facing === 1 ? 0.7 : 3.6,
      );
      g.strokePath();
    }
    g.fillStyle(0xfffcf0, 0.65);
    g.fillEllipse(racketX, racketY, 25, 36);
    g.lineStyle(3, color);
    g.strokeEllipse(racketX, racketY, 25, 36);
    g.lineStyle(1, color, 0.4);
    for (const offset of [-6, 0, 6]) {
      g.lineBetween(
        racketX + offset,
        racketY - 13,
        racketX + offset,
        racketY + 13,
      );
      g.lineBetween(
        racketX - 9,
        racketY + offset,
        racketX + 9,
        racketY + offset,
      );
    }
    g.fillStyle(INK);
    g.fillCircle(x, y - 101, 18);
    g.fillStyle(0xfff8df);
    g.fillCircle(x, y - 102, 13);
    this.line(g, x - 13, y - 107, x + 13, y - 107, 6, color);
    this.line(g, x - facing * 13, y - 107, x - facing * 25, y - 103, 4, color);
    g.fillStyle(INK);
    g.fillCircle(x + facing * 6, y - 100, 2.3);
  }

  private drawNet(g: Phaser.GameObjects.Graphics): void {
    g.fillStyle(0x224d46, 0.12);
    g.fillEllipse(510, 510, 45, 8);
    g.fillStyle(0xf5f3df, 0.72);
    g.fillRect(497, 340, 12, 160);
    g.lineStyle(1, 0x527e77, 0.6);
    for (let y = 350; y < 500; y += 9) g.lineBetween(497, y, 509, y);
    g.lineBetween(503, 340, 503, 500);
    this.line(g, 497, 339, 509, 339, 7, 0xfffbea);
    this.line(g, 498, 342, 498, 504, 5, 0x456e65);
    g.fillStyle(0xf5f2dd);
    g.fillCircle(498, 339, 5);
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
