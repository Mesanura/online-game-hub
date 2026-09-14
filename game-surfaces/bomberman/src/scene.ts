import Phaser from "phaser";
import type { PlayView } from "./contracts";
import {
  TILE_PIXELS,
  PLAYER_COLORS,
  bombSprite,
  brickSprite,
  flameSprite,
  floorSprite,
  paintPixels,
  pickupSprite,
  playerSprite,
  wallSprite,
  type PixelSprite,
} from "./pixels";

export type RenderFrame = {
  current: PlayView;
  previous: PlayView | null;
  receivedAt: number;
  interval: number;
  reducedMotion: boolean;
};
type Character = {
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
};
export class BombermanScene extends Phaser.Scene {
  readonly #tiles: Phaser.GameObjects.Image[] = [];
  readonly #tileKeys: string[] = [];
  readonly #bombs = new Map<number, Phaser.GameObjects.Image>();
  readonly #flames = new Map<number, Phaser.GameObjects.Image>();
  readonly #pickups = new Map<number, Phaser.GameObjects.Image>();
  readonly #players = new Map<string, Character>();
  #last: PlayView | null = null;
  constructor(private readonly frame: () => RenderFrame | null) {
    super("bomberman");
  }
  create(): void {
    this.#texture("floor-0", floorSprite());
    this.#texture("floor-1", floorSprite(true));
    this.#texture("wall", wallSprite);
    this.#texture("brick", brickSprite);
    this.#texture("bomb-0", bombSprite());
    this.#texture("bomb-1", bombSprite(true));
    this.#texture("flame-0", flameSprite(0));
    this.#texture("flame-1", flameSprite(1));
    for (const kind of ["capacity", "range", "speed"] as const)
      this.#texture("pickup-" + kind, pickupSprite(kind));
    for (let index = 0; index < PLAYER_COLORS.length; index += 1)
      for (const facing of ["up", "right", "down", "left"])
        for (const frame of [0, 1])
          this.#texture(
            "player-" + index + "-" + facing + "-" + frame,
            playerSprite(index, facing, frame),
          );
  }
  #texture(key: string, sprite: PixelSprite): void {
    const texture = this.textures.createCanvas(key, 16, sprite.rows.length);
    if (!texture) throw new Error("Pixel texture could not be created.");
    paintPixels(texture.context, sprite);
    texture.refresh();
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
  #image(
    map: Map<number, Phaser.GameObjects.Image>,
    id: number,
    texture: string,
    x: number,
    y: number,
    depth: number,
  ): Phaser.GameObjects.Image {
    let image = map.get(id);
    if (!image) {
      image = this.add
        .image(x, y, texture)
        .setDisplaySize(TILE_PIXELS, TILE_PIXELS)
        .setDepth(depth);
      map.set(id, image);
    }
    image.setTexture(texture).setPosition(x, y);
    return image;
  }
  #prune(
    map: Map<number, Phaser.GameObjects.Image>,
    ids: ReadonlySet<number>,
  ): void {
    for (const [id, image] of map)
      if (!ids.has(id)) {
        image.destroy();
        map.delete(id);
      }
  }
  override update(): void {
    const frame = this.frame();
    if (!frame) return;
    const view = frame.current;
    const now = performance.now();
    const phase = frame.reducedMotion ? 0 : Math.floor(now / 120) % 2;
    const position = (cell: number) => ({
      x: ((cell % view.arena.cols) + 0.5) * TILE_PIXELS,
      y: (Math.floor(cell / view.arena.cols) + 0.5) * TILE_PIXELS,
    });
    if (this.#last !== view) {
      if (
        this.#tiles.length !== view.arena.tiles.length ||
        this.#last?.arena.cols !== view.arena.cols
      ) {
        this.#tiles.forEach((tile) => tile.destroy());
        this.#tiles.length = 0;
        this.#tileKeys.length = 0;
      }
      view.arena.tiles.forEach((tile, cell) => {
        const p = position(cell);
        const key =
          tile === "floor"
            ? "floor-" +
              (((cell % view.arena.cols) + Math.floor(cell / view.arena.cols)) %
                2)
            : tile;
        let image = this.#tiles[cell];
        if (!image) {
          image = this.add
            .image(p.x, p.y, key)
            .setDisplaySize(TILE_PIXELS, TILE_PIXELS)
            .setDepth(0);
          this.#tiles[cell] = image;
        }
        if (this.#tileKeys[cell] !== key) {
          image.setTexture(key);
          this.#tileKeys[cell] = key;
        }
      });
      this.#prune(this.#bombs, new Set(view.bombs.map((bomb) => bomb.id)));
      this.#prune(
        this.#flames,
        new Set(view.flames.map((flame) => flame.cell)),
      );
      this.#prune(
        this.#pickups,
        new Set(view.pickups.map((pickup) => pickup.cell)),
      );
      for (const [slot, character] of this.#players)
        if (!view.players.some((player) => player.slotId === slot)) {
          character.image.destroy();
          character.shadow.destroy();
          character.label.destroy();
          this.#players.delete(slot);
        }
      this.#last = view;
    }
    for (const pickup of view.pickups) {
      const p = position(pickup.cell);
      this.#image(
        this.#pickups,
        pickup.cell,
        "pickup-" + pickup.kind,
        p.x,
        p.y - (frame.reducedMotion ? 0 : phase),
        1,
      ).setDisplaySize(26, 26);
    }
    for (const bomb of view.bombs) {
      const p = position(bomb.cell);
      this.#image(
        this.#bombs,
        bomb.id,
        "bomb-" + (bomb.fuseTicks <= 45 ? phase : 0),
        p.x,
        p.y,
        2,
      );
    }
    for (const flame of view.flames) {
      const p = position(flame.cell);
      this.#image(this.#flames, flame.cell, "flame-" + phase, p.x, p.y, 3);
    }
    const alpha = frame.reducedMotion
      ? 1
      : Math.min(1, Math.max(0, (now - frame.receivedAt) / frame.interval));
    for (const player of view.players) {
      const palette = player.index % PLAYER_COLORS.length;
      const animation = player.walking && !frame.reducedMotion ? phase : 0;
      const texture =
        "player-" + palette + "-" + player.facing + "-" + animation;
      let character = this.#players.get(player.slotId);
      if (!character) {
        character = {
          shadow: this.add.ellipse(0, 0, 21, 8, 0x344d45, 0.25).setDepth(4),
          image: this.add
            .image(0, 0, texture)
            .setOrigin(0.5, 0.7)
            .setDisplaySize(32, 40),
          label: this.add
            .text(0, 0, "P" + (player.index + 1), {
              fontFamily: "monospace",
              fontSize: "10px",
              fontStyle: "bold",
              color: "#ffffff",
              stroke: "#2e3d55",
              strokeThickness: 3,
            })
            .setOrigin(0.5)
            .setDepth(1000),
        };
        this.#players.set(player.slotId, character);
      }
      const before = frame.previous?.players.find(
        (entry) => entry.slotId === player.slotId,
      );
      const interpolate =
        before?.alive &&
        player.alive &&
        before.facing === player.facing &&
        Math.abs(before.x - player.x) + Math.abs(before.y - player.y) <=
          view.arena.cellSize;
      const x =
        ((interpolate ? before.x + (player.x - before.x) * alpha : player.x) /
          view.arena.cellSize) *
        TILE_PIXELS;
      const y =
        ((interpolate ? before.y + (player.y - before.y) * alpha : player.y) /
          view.arena.cellSize) *
        TILE_PIXELS;
      character.image
        .setTexture(texture)
        .setPosition(Math.round(x), Math.round(y))
        .setVisible(player.alive)
        .setDepth(10 + y);
      character.shadow
        .setPosition(Math.round(x), Math.round(y + 8))
        .setVisible(player.alive);
      character.label
        .setPosition(Math.round(x), Math.round(y - 32))
        .setVisible(player.alive);
    }
  }
}
