import Phaser from "phaser";

import {
  PONG_BALL_RADIUS,
  PONG_FIELD_HEIGHT,
  PONG_FIELD_WIDTH,
  PONG_LEFT_PADDLE_X,
  PONG_PADDLE_HEIGHT,
  PONG_PADDLE_WIDTH,
  PONG_RIGHT_PADDLE_X,
  type PongPlayView,
} from "./contracts";
import {
  interpolationAlpha,
  lerp,
  serveArrowVisible,
  winnerText,
} from "./model";

const COURT_BORDER_COLOR = 0xaedcd6;
const COURT_BORDER_ALPHA = 0.72;

export interface PongRenderState {
  readonly gameVersion: string;
  readonly current: PongPlayView;
  readonly previous: PongPlayView | null;
  readonly receivedAt: number;
  readonly reducedMotion: boolean;
}

interface PongSceneOptions {
  readonly getRenderState: () => PongRenderState | null;
  readonly onDirection: (direction: -1 | 0 | 1) => void;
  readonly canControl: () => boolean;
}

export class PongScene extends Phaser.Scene {
  readonly #options: PongSceneOptions;
  readonly #pressed = new Set<string>();
  #graphics: Phaser.GameObjects.Graphics | null = null;
  #score: Phaser.GameObjects.Text | null = null;
  #result: Phaser.GameObjects.Text | null = null;
  #lastDirection: -1 | 0 | 1 = 0;

  constructor(options: PongSceneOptions) {
    super({ key: "pong" });
    this.#options = options;
  }

  create(): void {
    this.#graphics = this.add.graphics();
    this.#score = this.add
      .text(400, 22, "0  :  0", {
        color: "#fff8e8",
        fontFamily: "system-ui, sans-serif",
        fontSize: "28px",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0);
    this.#result = this.add
      .text(400, 200, "", {
        align: "center",
        backgroundColor: "rgba(20, 31, 42, 0.72)",
        color: "#fff8e8",
        fontFamily: "system-ui, sans-serif",
        fontSize: "36px",
        fontStyle: "bold",
        padding: { x: 22, y: 14 },
      })
      .setOrigin(0.5)
      .setDepth(2);
    this.input.keyboard?.on("keydown", this.#handleKeyDown);
    this.input.keyboard?.on("keyup", this.#handleKeyUp);
  }

  override update(): void {
    const render = this.#options.getRenderState();
    if (
      render === null ||
      this.#graphics === null ||
      this.#score === null ||
      this.#result === null
    ) {
      return;
    }
    const alpha =
      render.reducedMotion || render.previous === null
        ? 1
        : interpolationAlpha(performance.now() - render.receivedAt);
    const previous = render.previous ?? render.current;
    const serve = render.current.serve;
    const ballX =
      serve === null
        ? lerp(previous.ball.x, render.current.ball.x, alpha)
        : render.current.ball.x;
    const ballY =
      serve === null
        ? lerp(previous.ball.y, render.current.ball.y, alpha)
        : render.current.ball.y;
    const leftY = lerp(
      previous.paddles[0].y,
      render.current.paddles[0].y,
      alpha,
    );
    const rightY = lerp(
      previous.paddles[1].y,
      render.current.paddles[1].y,
      alpha,
    );
    const scaleX = 800 / PONG_FIELD_WIDTH;
    const scaleY = 400 / PONG_FIELD_HEIGHT;

    this.#graphics.clear();
    this.#graphics.lineStyle(4, COURT_BORDER_COLOR, COURT_BORDER_ALPHA);
    this.#graphics.strokeRoundedRect(4, 4, 792, 392, 10);
    this.#graphics.lineStyle(2, 0x6e8e91, 0.72);
    this.#graphics.lineBetween(400, 12, 400, 388);
    this.#graphics.fillStyle(0xf3b29f, 1);
    this.#graphics.fillRoundedRect(
      (PONG_LEFT_PADDLE_X - PONG_PADDLE_WIDTH / 2) * scaleX,
      (leftY - PONG_PADDLE_HEIGHT / 2) * scaleY,
      PONG_PADDLE_WIDTH * scaleX,
      PONG_PADDLE_HEIGHT * scaleY,
      5,
    );
    this.#graphics.fillStyle(0x7fd0c4, 1);
    this.#graphics.fillRoundedRect(
      (PONG_RIGHT_PADDLE_X - PONG_PADDLE_WIDTH / 2) * scaleX,
      (rightY - PONG_PADDLE_HEIGHT / 2) * scaleY,
      PONG_PADDLE_WIDTH * scaleX,
      PONG_PADDLE_HEIGHT * scaleY,
      5,
    );
    if (serve !== null && render.current.outcome === null) {
      if (
        serveArrowVisible(
          render.current,
          render.reducedMotion,
          render.gameVersion,
        )
      ) {
        const direction = serve.directionX;
        const x = 400 + direction * 24;
        this.#graphics.fillStyle(COURT_BORDER_COLOR, COURT_BORDER_ALPHA);
        this.#graphics.fillPoints(
          [
            { x: x - direction * 12, y: 96 },
            { x, y: 96 },
            { x, y: 90 },
            { x: x + direction * 12, y: 100 },
            { x, y: 110 },
            { x, y: 104 },
            { x: x - direction * 12, y: 104 },
          ],
          true,
        );
      }
    } else {
      this.#graphics.fillStyle(0xfff4c7, 1);
      this.#graphics.fillCircle(
        ballX * scaleX,
        ballY * scaleY,
        PONG_BALL_RADIUS * scaleX,
      );
    }
    this.#score.setText(
      `${render.current.scores[0]}  :  ${render.current.scores[1]}`,
    );
    this.#result.setText(winnerText(render.current));
    this.#result.setVisible(render.current.outcome !== null);
  }

  syncDirection(): void {
    this.#recomputeDirection(true);
  }

  readonly #handleKeyDown = (event: KeyboardEvent): void => {
    if (!["ArrowUp", "ArrowDown", "KeyW", "KeyS"].includes(event.code)) return;
    event.preventDefault();
    this.#pressed.add(event.code);
    this.#recomputeDirection(false);
  };

  readonly #handleKeyUp = (event: KeyboardEvent): void => {
    if (!["ArrowUp", "ArrowDown", "KeyW", "KeyS"].includes(event.code)) return;
    event.preventDefault();
    this.#pressed.delete(event.code);
    this.#recomputeDirection(false);
  };

  #recomputeDirection(force: boolean): void {
    const up = this.#pressed.has("ArrowUp") || this.#pressed.has("KeyW");
    const down = this.#pressed.has("ArrowDown") || this.#pressed.has("KeyS");
    const direction: -1 | 0 | 1 = up === down ? 0 : up ? -1 : 1;
    if (!force && direction === this.#lastDirection) return;
    this.#lastDirection = direction;
    if (this.#options.canControl()) this.#options.onDirection(direction);
  }
}
