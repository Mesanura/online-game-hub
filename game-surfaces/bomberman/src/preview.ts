import {
  brickSprite,
  floorSprite,
  paintPixels,
  playerSprite,
  wallSprite,
} from "./pixels";
export function drawPreview(
  canvas: HTMLCanvasElement,
  playerCount: number,
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < 11; y += 1)
    for (let x = 0; x < 13; x += 1) {
      const wall =
        x === 0 ||
        y === 0 ||
        x === 12 ||
        y === 10 ||
        (x % 2 === 0 && y % 2 === 0);
      const safe = (x <= 3 || x >= 9) && (y <= 3 || y >= 7);
      const sprite = wall
        ? wallSprite
        : !safe && (x + y) % 3 !== 0
          ? brickSprite
          : floorSprite((x + y) % 2 === 1);
      paintPixels(context, sprite, 1, x * 16, y * 16);
    }
  const corners = [
    [1, 1],
    [11, 1],
    [11, 9],
    [1, 9],
  ] as const;
  const indices =
    playerCount === 2
      ? [0, 2]
      : Array.from({ length: playerCount }, (_, index) => index);
  indices.forEach((corner, player) => {
    const point = corners[corner];
    if (point)
      paintPixels(
        context,
        playerSprite(player, "down", 0),
        1,
        point[0] * 16,
        point[1] * 16 - 5,
      );
  });
}
