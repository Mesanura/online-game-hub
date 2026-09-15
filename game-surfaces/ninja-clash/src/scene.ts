import Phaser from "phaser";
import type { PlayView } from "./contracts";
import { colors } from "./model";
import type { FeedbackTimeline } from "./feedback";
const ninjaAssets = import.meta.glob("../assets/ninja/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const environmentAssets = import.meta.glob("../assets/environment/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
export const backgroundUrl = required(
  environmentAssets["../assets/environment/background.png"],
);
export class NinjaScene extends Phaser.Scene {
  private ink: Phaser.GameObjects.Graphics | null = null;
  private effectsInk: Phaser.GameObjects.Graphics | null = null;
  private fighters = new Map<
    string,
    { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text }
  >();
  private mapBuilt = false;
  constructor(
    private readonly read: () => {
      view: PlayView | null;
      previous: PlayView | null;
      receivedAt: number;
      interval: number;
      reduced: boolean;
    },
    private readonly feedback: FeedbackTimeline,
  ) {
    super("ninja-arena");
  }
  preload() {
    for (const [path, url] of Object.entries(ninjaAssets)) {
      const name = required(path.split("/").at(-1)).replace(".png", "");
      this.load.spritesheet(name, url, {
        frameWidth: name === "p_hit1" ? 40 : 26,
        frameHeight: name === "p_hit1" ? 24 : 23,
      });
    }
    this.load.spritesheet(
      "tiles",
      required(
        environmentAssets["../assets/environment/Sci-Fi_Tileset_Packed.png"],
      ),
      { frameWidth: 16, frameHeight: 16 },
    );
    this.load.spritesheet(
      "props",
      required(
        environmentAssets["../assets/environment/Sci-Fi_Props_Spritesheet.png"],
      ),
      { frameWidth: 16, frameHeight: 16 },
    );
    this.load.image("backdrop", backgroundUrl);
  }
  create() {
    this.cameras.main.setBackgroundColor("#141725");
    this.add
      .image(320, 180, "backdrop")
      .setDisplaySize(640, 360)
      .setAlpha(0.35);
    const g = this.add.graphics();
    g.lineStyle(1, 0x495468, 0.15);
    for (let x = 0; x < 640; x += 32) g.lineBetween(x, 0, x, 360);
    for (let y = 0; y < 360; y += 32) g.lineBetween(0, y, 640, y);
    this.ink = this.add.graphics().setDepth(3);
    this.effectsInk = this.add
      .graphics()
      .setDepth(8)
      .setBlendMode(Phaser.BlendModes.ADD);
  }
  override update() {
    const { view, previous, receivedAt, interval, reduced } = this.read();
    if (!view || !this.ink || !this.effectsInk) return;
    if (!this.mapBuilt) {
      this.mapBuilt = true;
      for (const r of view.arena.platforms) {
        for (let x = r.x / 100; x < (r.x + r.w) / 100; x += 16)
          for (let y = r.y / 100; y < (r.y + r.h) / 100; y += 16)
            this.add
              .image(x + 8, y + 8, "tiles", y === r.y / 100 ? 1 : 7)
              .setDepth(1);
        this.add
          .rectangle(
            r.x / 100 + r.w / 200,
            r.y / 100 + 1,
            r.w / 100,
            2,
            0x76e5d0,
            0.8,
          )
          .setDepth(2);
      }
      for (const [x, y, frame] of [
        [112, 264, 0],
        [528, 264, 2],
        [320, 136, 9],
        [96, 328, 13],
        [544, 328, 16],
      ])
        this.add
          .image(required(x), required(y), "props", required(frame))
          .setDepth(2);
      this.add
        .text(320, 59, "NEON DOJO", {
          fontFamily: "monospace",
          fontSize: "13px",
          color: "#64768c",
          letterSpacing: 5,
        })
        .setOrigin(0.5)
        .setAlpha(0.55);
    }
    const blend =
      reduced || view.hitstopTicks > 0
        ? 1
        : Phaser.Math.Clamp((performance.now() - receivedAt) / interval, 0, 1);
    this.ink.clear();
    for (const p of view.players) {
      let entity = this.fighters.get(p.slotId);
      if (!entity) {
        entity = {
          sprite: this.add
            .sprite(0, 0, "p_idle")
            .setOrigin(11 / 26, 1)
            .setScale(2)
            .setDepth(5),
          label: this.add
            .text(0, 0, "", {
              fontFamily: "monospace",
              fontSize: "9px",
              color: required(colors[p.index]),
              stroke: "#111522",
              strokeThickness: 3,
            })
            .setOrigin(0.5, 1)
            .setDepth(6),
        };
        this.fighters.set(p.slotId, entity);
      }
      entity.sprite.setVisible(p.alive);
      entity.label.setVisible(p.alive);
      if (!p.alive) continue;
      const old = previous?.players.find(
        (o) => o.slotId === p.slotId && o.alive,
      );
      const x = Math.round((old ? old.x + (p.x - old.x) * blend : p.x) / 100);
      const y = Math.round((old ? old.y + (p.y - old.y) * blend : p.y) / 100);
      const texture = {
        IDLE: "p_idle",
        RUN: "p_run",
        RISE: "p_ascend",
        FALL: "p_descend",
        WALL: "p_wallgrab",
        ATTACK: "p_hit1",
        CLASH: "p_hit1",
        SLIDE: "p_slide",
      }[p.motion];
      const frame =
        p.motion === "CLASH"
          ? 2
          : p.motion === "WALL"
            ? 0
            : p.motion === "ATTACK"
              ? Math.min(2, Math.floor(p.attackAge / 2))
              : Math.floor(view.animationTick / (p.motion === "RUN" ? 5 : 10)) %
                4;
      entity.sprite
        .setTexture(texture, frame)
        .setOrigin(texture === "p_hit1" ? 18 / 40 : 11 / 26, 1)
        .setPosition(x, y)
        .setFlipX(
          (["ATTACK", "CLASH"].includes(p.motion)
            ? p.attackFacing
            : p.facing) === -1,
        )
        .setTint(
          Phaser.Display.Color.HexStringToColor(required(colors[p.index]))
            .color,
        );
      entity.label
        .setText(
          "P" + (p.index + 1) + (p.slotId === view.selfSlotId ? " ▼" : ""),
        )
        .setPosition(x, y - 27);
      const color = Phaser.Display.Color.HexStringToColor(
        required(colors[p.index]),
      ).color;
      this.ink.fillStyle(color, 0.9).fillRect(x - 5, y + 1, 10, 2);
      if (p.invulnerable) {
        this.ink
          .lineStyle(1, color, 1)
          .strokeRoundedRect(x - 14, y - 18, 28, 20, 7);
        if (!reduced) {
          this.ink
            .fillStyle(color, 0.16)
            .fillRoundedRect(x - p.facing * 18 - 13, y - 13, 26, 13, 5);
          this.ink
            .fillStyle(color, 0.07)
            .fillRoundedRect(x - p.facing * 32 - 13, y - 13, 26, 13, 5);
        }
      }
      if (p.blade) {
        const b = p.blade;
        this.ink
          .fillStyle(0xe8fff9, 0.38)
          .fillRect(b.x / 100, b.y / 100, b.w / 100, b.h / 100);
        this.ink
          .lineStyle(1, 0xffffff, 0.9)
          .lineBetween(
            b.x / 100,
            b.y / 100 + b.h / 200,
            (b.x + b.w) / 100,
            b.y / 100 + b.h / 200,
          );
      }
    }
    const ink = this.effectsInk;
    ink.clear();
    for (const effect of this.feedback.frames(performance.now(), reduced)) {
      ink
        .lineStyle(
          1,
          effect.kind === "CLASH" ? 0xffdc8b : 0xffffff,
          effect.alpha * 0.8,
        )
        .strokeCircle(effect.x, effect.y, effect.radius);
      if (effect.flash > 0) {
        const length = effect.flash * (effect.kind === "CLASH" ? 25 : 16);
        ink
          .lineStyle(3, 0xffffff, effect.flash)
          .lineBetween(
            effect.x - length,
            effect.y,
            effect.x + length,
            effect.y,
          );
        ink
          .lineStyle(2, 0xffffff, effect.flash)
          .lineBetween(
            effect.x,
            effect.y - length,
            effect.x,
            effect.y + length,
          );
        ink
          .fillStyle(0xffffff, effect.flash)
          .fillRect(effect.x - 3, effect.y - 3, 6, 6);
      }
      for (const p of effect.particles) {
        if (effect.kind === "CLASH")
          ink
            .lineStyle(p.size, p.color, p.alpha)
            .lineBetween(p.tailX, p.tailY, p.x, p.y);
        else
          ink
            .fillStyle(p.color, p.alpha)
            .fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
    }
  }
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected value to be present");
  return value;
}
