import {
  CHINESE_CHECKERS_BOARD_RADIUS,
  CHINESE_CHECKERS_CAMP_OPTIONS,
  CHINESE_CHECKERS_CELL_COUNT,
} from "./constants.js";
import type {
  ChineseCheckersCamp,
  ChineseCheckersCellGeometry,
} from "./types.js";

export type AxialCoordinate = Readonly<{ q: number; r: number }>;

export const CHINESE_CHECKERS_DIRECTIONS = Object.freeze([
  Object.freeze({ q: 0, r: -1 }),
  Object.freeze({ q: 1, r: -1 }),
  Object.freeze({ q: 1, r: 0 }),
  Object.freeze({ q: 0, r: 1 }),
  Object.freeze({ q: -1, r: 1 }),
  Object.freeze({ q: -1, r: 0 }),
]);

const BOARD_ROWS = [
  [3, 1],
  [2, 2],
  [1, 3],
  [-3, 10],
  [-3, 9],
  [-3, 8],
  [-3, 7],
  [-4, 8],
  [-5, 9],
  [-6, 10],
  [-3, 3],
  [-3, 2],
  [-3, 1],
] as const;

function key({ q, r }: AxialCoordinate): string {
  return `${q},${r}`;
}

function coordinateCamp({ q, r }: AxialCoordinate): ChineseCheckersCamp | null {
  const radius = CHINESE_CHECKERS_BOARD_RADIUS;
  const diagonalCoordinate = -q - r;
  if (r < -radius) return "N";
  if (q > radius) return "NE";
  if (diagonalCoordinate < -radius) return "SE";
  if (r > radius) return "S";
  if (q < -radius) return "SW";
  if (diagonalCoordinate > radius) return "NW";
  return null;
}

export const CHINESE_CHECKERS_COORDINATES = Object.freeze(
  BOARD_ROWS.flatMap(([firstQ, count], row) =>
    Array.from({ length: count }, (_, column) =>
      Object.freeze({ q: firstQ + column, r: row - 6 }),
    ),
  ),
);

if (CHINESE_CHECKERS_COORDINATES.length !== CHINESE_CHECKERS_CELL_COUNT) {
  throw new Error("Chinese Checkers geometry must contain 73 cells.");
}

export const CHINESE_CHECKERS_GEOMETRY: readonly ChineseCheckersCellGeometry[] =
  Object.freeze(
    CHINESE_CHECKERS_COORDINATES.map((coordinate) =>
      Object.freeze({ ...coordinate, camp: coordinateCamp(coordinate) }),
    ),
  );

const indexByCoordinate = new Map(
  CHINESE_CHECKERS_COORDINATES.map((coordinate, cell) => [
    key(coordinate),
    cell,
  ]),
);

export const CHINESE_CHECKERS_CAMP_CELLS = Object.freeze(
  Object.fromEntries(
    CHINESE_CHECKERS_CAMP_OPTIONS.map((camp) => [
      camp,
      Object.freeze(
        CHINESE_CHECKERS_GEOMETRY.flatMap((geometry, cell) =>
          geometry.camp === camp ? [cell] : [],
        ),
      ),
    ]),
  ) as Record<ChineseCheckersCamp, readonly number[]>,
);

export const CHINESE_CHECKERS_CENTER_CELLS = Object.freeze(
  CHINESE_CHECKERS_GEOMETRY.flatMap((geometry, cell) =>
    geometry.camp === null ? [cell] : [],
  ),
);

export function cellCoordinate(cell: number): AxialCoordinate | undefined {
  return CHINESE_CHECKERS_COORDINATES[cell];
}

export function cellIndex(coordinate: AxialCoordinate): number | undefined {
  return indexByCoordinate.get(key(coordinate));
}

function offsetCell(cell: number, direction: AxialCoordinate, steps: number) {
  const coordinate = cellCoordinate(cell);
  return coordinate === undefined
    ? undefined
    : cellIndex({
        q: coordinate.q + direction.q * steps,
        r: coordinate.r + direction.r * steps,
      });
}

export function adjacentCells(cell: number): readonly number[] {
  return CHINESE_CHECKERS_DIRECTIONS.flatMap((direction) => {
    const neighbor = offsetCell(cell, direction, 1);
    return neighbor === undefined ? [] : [neighbor];
  });
}

export function campForCell(cell: number): ChineseCheckersCamp | null {
  return CHINESE_CHECKERS_GEOMETRY[cell]?.camp ?? null;
}

export function oppositeCamp(camp: ChineseCheckersCamp): ChineseCheckersCamp {
  const index = CHINESE_CHECKERS_CAMP_OPTIONS.indexOf(camp);
  return CHINESE_CHECKERS_CAMP_OPTIONS[(index + 3) % 6] ?? "N";
}

export function jumpLanding(
  cell: number,
  directionIndex: number,
): Readonly<{ over: number; landing: number }> | null {
  const direction = CHINESE_CHECKERS_DIRECTIONS[directionIndex];
  if (direction === undefined) return null;
  const over = offsetCell(cell, direction, 1);
  const landing = offsetCell(cell, direction, 2);
  return over === undefined || landing === undefined ? null : { over, landing };
}
