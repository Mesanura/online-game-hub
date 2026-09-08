import PathFinding from "pathfinding";
import { clear, sweepWall } from "./geometry.js";
import type { Arena, Bullet } from "./schemas.js";

const CELL = 100000;
const HALF_CELL = CELL / 2;
type Point = Readonly<{ x: number; y: number }>;

function visible(
  arena: Readonly<Arena>,
  from: Point,
  to: Point,
  radius: number,
) {
  return arena.walls.every(
    (wall) =>
      sweepWall(from.x, from.y, to.x - from.x, to.y - from.y, radius, wall) ===
      null,
  );
}

function navigationGrid(arena: Readonly<Arena>, radius: number) {
  // Cell centers and passage midpoints are separate nodes; walls lie between cells.
  const matrix = Array.from({ length: arena.rows * 2 - 1 }, (_, row) =>
    Array.from({ length: arena.cols * 2 - 1 }, (_, col) => {
      if (col % 2 === 1 && row % 2 === 1) return 1;
      const x = (col + 1) * HALF_CELL;
      const y = (row + 1) * HALF_CELL;
      if (!clear(x, y, radius, arena.walls)) return 1;
      const dx = col % 2 === 1 ? HALF_CELL : 0;
      const dy = row % 2 === 1 ? HALF_CELL : 0;
      return visible(
        arena,
        { x: x - dx, y: y - dy },
        { x: x + dx, y: y + dy },
        radius,
      )
        ? 0
        : 1;
    }),
  );
  return new PathFinding.Grid(matrix);
}

export function createMissileNavigator(arena: Readonly<Arena>) {
  // This cache lives for one simulation tick, never in State or across matches.
  const grids = new Map<number, PathFinding.Grid>();
  const finder = new PathFinding.AStarFinder({
    diagonalMovement: PathFinding.DiagonalMovement.Never,
  });
  return (
    missile: Readonly<Pick<Bullet, "x" | "y" | "radius">>,
    target: Point,
  ): Point | null => {
    if (visible(arena, missile, target, missile.radius)) return target;
    let grid = grids.get(missile.radius);
    if (grid === undefined) {
      grid = navigationGrid(arena, missile.radius);
      grids.set(missile.radius, grid);
    }
    const startX = Math.floor(missile.x / CELL) * 2;
    const startY = Math.floor(missile.y / CELL) * 2;
    const endX = Math.floor(target.x / CELL) * 2;
    const endY = Math.floor(target.y / CELL) * 2;
    if (!grid.isWalkableAt(startX, startY) || !grid.isWalkableAt(endX, endY))
      return null;
    const path = finder.findPath(startX, startY, endX, endY, grid.clone());
    let aim: Point | null = null;
    for (const [col, row] of path) {
      if (col === undefined || row === undefined)
        throw new Error("Invalid missile navigation waypoint.");
      const waypoint = { x: (col + 1) * HALF_CELL, y: (row + 1) * HALF_CELL };
      if (!visible(arena, missile, waypoint, missile.radius)) break;
      aim = waypoint;
    }
    return aim;
  };
}
