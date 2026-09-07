import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PongPlayView } from "../src/contracts";
import { PongScene } from "../src/pong-scene";

const drawing = vi.hoisted(() => ({
  graphics: {
    clear: vi.fn(),
    lineStyle: vi.fn(),
    strokeRoundedRect: vi.fn(),
    lineBetween: vi.fn(),
    fillStyle: vi.fn(),
    fillRoundedRect: vi.fn(),
    fillPoints: vi.fn(),
    fillCircle: vi.fn(),
  },
  text: {
    setOrigin: vi.fn().mockReturnThis(),
    setDepth: vi.fn().mockReturnThis(),
    setText: vi.fn(),
    setVisible: vi.fn(),
  },
}));

vi.mock("phaser", () => ({
  default: {
    Scene: class {
      add = { graphics: () => drawing.graphics, text: () => drawing.text };
      input = { keyboard: { on: vi.fn() } };
    },
  },
}));

const view: PongPlayView = {
  field: { width: 800_000, height: 400_000 },
  players: [
    { slotId: "left", side: "LEFT" },
    { slotId: "right", side: "RIGHT" },
  ],
  paddles: [
    { y: 200_000, height: 80_000 },
    { y: 200_000, height: 80_000 },
  ],
  ball: { x: 400_000, y: 200_000, radius: 8_000 },
  scores: [0, 0],
  tick: 0,
  targetScore: 3,
  yourSide: "LEFT",
  serve: null,
  outcome: null,
};

function render(current: PongPlayView): void {
  const scene = new PongScene({
    getRenderState: () => ({
      gameVersion: "1.2.0",
      current,
      previous: null,
      receivedAt: 0,
      reducedMotion: false,
    }),
    canControl: () => false,
    onDirection: vi.fn(),
  });
  scene.create();
  scene.update();
}

beforeEach(() => vi.clearAllMocks());

describe("Pong serve drawing", () => {
  it.each([
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const)(
    "draws a small solid horizontal arrow for direction (%s, %s), using the border color without an outline",
    (directionX, directionY) => {
      render({
        ...view,
        serve: { ticksRemaining: 120, directionX, directionY },
      });
      const x = 400 + directionX * 24;
      expect(drawing.graphics.fillPoints).toHaveBeenCalledExactlyOnceWith(
        [
          { x: x - directionX * 12, y: 96 },
          { x, y: 96 },
          { x, y: 90 },
          { x: x + directionX * 12, y: 100 },
          { x, y: 110 },
          { x, y: 104 },
          { x: x - directionX * 12, y: 104 },
        ],
        true,
      );
      const [, borderColor, borderAlpha] =
        drawing.graphics.lineStyle.mock.calls[0] ?? [];
      expect(drawing.graphics.fillStyle).toHaveBeenLastCalledWith(
        borderColor,
        borderAlpha,
      );
      expect(drawing.graphics.lineStyle).toHaveBeenCalledTimes(2);
      expect(drawing.graphics.lineBetween).toHaveBeenCalledExactlyOnceWith(
        400,
        12,
        400,
        388,
      );
      expect(drawing.graphics.fillCircle).not.toHaveBeenCalled();
    },
  );

  it.each([
    [120, true],
    [90, false],
    [60, true],
    [30, false],
    [1, false],
  ] as const)(
    "renders countdown %s with arrow visibility %s and no premature ball",
    (ticksRemaining, visible) => {
      render({
        ...view,
        serve: { ticksRemaining, directionX: 1, directionY: -1 },
      });
      expect(drawing.graphics.fillPoints).toHaveBeenCalledTimes(
        visible ? 1 : 0,
      );
      expect(drawing.graphics.fillCircle).not.toHaveBeenCalled();
    },
  );

  it("restores the ball only after preparation ends", () => {
    render(view);
    expect(drawing.graphics.fillPoints).not.toHaveBeenCalled();
    expect(drawing.graphics.fillCircle).toHaveBeenCalledExactlyOnceWith(
      400,
      200,
      8,
    );
  });
});
