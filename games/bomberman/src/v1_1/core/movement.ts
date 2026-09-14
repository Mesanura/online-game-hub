import { CELL_SIZE, PLAYER_HALF_SIZE, TURN_ASSIST } from "../definitions.js";
import type { Arena, Bomb, Player } from "./model.js";

export type Segment = { x1: number; y1: number; x2: number; y2: number };
export function cellCenter(
  cell: number,
  cols: number,
): { x: number; y: number } {
  return {
    x: (cell % cols) * CELL_SIZE + CELL_SIZE / 2,
    y: Math.floor(cell / cols) * CELL_SIZE + CELL_SIZE / 2,
  };
}
export function playerCell(
  player: Pick<Player, "x" | "y">,
  cols: number,
): number {
  return (
    Math.floor(player.y / CELL_SIZE) * cols + Math.floor(player.x / CELL_SIZE)
  );
}
export function overlapsCell(
  x: number,
  y: number,
  cell: number,
  cols: number,
): boolean {
  const center = cellCenter(cell, cols);
  return (
    Math.abs(x - center.x) < CELL_SIZE / 2 + PLAYER_HALF_SIZE &&
    Math.abs(y - center.y) < CELL_SIZE / 2 + PLAYER_HALF_SIZE
  );
}
export function pathTouchesCell(
  segment: Segment,
  cell: number,
  cols: number,
): boolean {
  const center = cellCenter(cell, cols);
  const half = CELL_SIZE / 2 + PLAYER_HALF_SIZE;
  return (
    Math.max(segment.x1, segment.x2) > center.x - half &&
    Math.min(segment.x1, segment.x2) < center.x + half &&
    Math.max(segment.y1, segment.y2) > center.y - half &&
    Math.min(segment.y1, segment.y2) < center.y + half
  );
}

function moveAxis(
  player: Player,
  arena: Arena,
  bombs: readonly Bomb[],
  axis: "x" | "y",
  amount: number,
): Segment {
  const start = player[axis];
  let target = start + amount;
  const x1 = player.x;
  const y1 = player.y;
  const minX = Math.floor(
    (Math.min(player.x, axis === "x" ? target : player.x) - PLAYER_HALF_SIZE) /
      CELL_SIZE,
  );
  const maxX = Math.floor(
    (Math.max(player.x, axis === "x" ? target : player.x) +
      PLAYER_HALF_SIZE -
      1) /
      CELL_SIZE,
  );
  const minY = Math.floor(
    (Math.min(player.y, axis === "y" ? target : player.y) - PLAYER_HALF_SIZE) /
      CELL_SIZE,
  );
  const maxY = Math.floor(
    (Math.max(player.y, axis === "y" ? target : player.y) +
      PLAYER_HALF_SIZE -
      1) /
      CELL_SIZE,
  );
  for (let row = minY; row <= maxY; row += 1) {
    for (let col = minX; col <= maxX; col += 1) {
      const cell = row * arena.cols + col;
      const outside =
        col < 0 || row < 0 || col >= arena.cols || row >= arena.rows;
      const blocked =
        outside ||
        arena.tiles[cell] !== "floor" ||
        bombs.some(
          (bomb) =>
            bomb.cell === cell && !bomb.passThrough.includes(player.slotId),
        );
      if (!blocked) continue;
      const low = (axis === "x" ? col : row) * CELL_SIZE;
      const high = low + CELL_SIZE;
      if (amount > 0 && start + PLAYER_HALF_SIZE <= low)
        target = Math.min(target, low - PLAYER_HALF_SIZE);
      if (amount < 0 && start - PLAYER_HALF_SIZE >= high)
        target = Math.max(target, high + PLAYER_HALF_SIZE);
    }
  }
  player[axis] = target;
  return { x1, y1, x2: player.x, y2: player.y };
}

/** Axis-aligned corner assistance spends the same movement budget as travel. */
export function movePlayer(
  player: Player,
  arena: Arena,
  bombs: readonly Bomb[],
): Segment[] {
  player.walking = false;
  if (
    !player.alive ||
    player.resigned ||
    player.direction === "none" ||
    player.lease <= 0
  )
    return [];
  const direction = player.direction;
  const axis = direction === "left" || direction === "right" ? "x" : "y";
  const perpendicular = axis === "x" ? "y" : "x";
  const center =
    Math.floor(player[perpendicular] / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
  const correction = center - player[perpendicular];
  if (Math.abs(correction) > TURN_ASSIST) return [];
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  // Only assist toward an open turning lane. Pressing before the body's
  // midpoint clears a corner must not pull it back toward the wall's column.
  if (correction !== 0) {
    const col = Math.floor((axis === "x" ? player.x : center) / CELL_SIZE);
    const row = Math.floor((axis === "y" ? player.y : center) / CELL_SIZE);
    const nextCol = col + (axis === "x" ? sign : 0);
    const nextRow = row + (axis === "y" ? sign : 0);
    const nextCell = nextRow * arena.cols + nextCol;
    if (
      nextCol < 0 ||
      nextCol >= arena.cols ||
      nextRow < 0 ||
      nextRow >= arena.rows ||
      arena.tiles[nextCell] !== "floor" ||
      bombs.some(
        (bomb) =>
          bomb.cell === nextCell && !bomb.passThrough.includes(player.slotId),
      )
    )
      return [];
  }
  let budget = player.speed;
  const segments: Segment[] = [];
  if (correction !== 0) {
    const amount =
      Math.sign(correction) * Math.min(Math.abs(correction), budget);
    const segment = moveAxis(player, arena, bombs, perpendicular, amount);
    segments.push(segment);
    budget -=
      Math.abs(segment.x2 - segment.x1) + Math.abs(segment.y2 - segment.y1);
  }
  if (player[perpendicular] === center && budget > 0)
    segments.push(moveAxis(player, arena, bombs, axis, sign * budget));
  player.walking = segments.some(
    (segment) => segment.x1 !== segment.x2 || segment.y1 !== segment.y2,
  );
  return segments;
}
