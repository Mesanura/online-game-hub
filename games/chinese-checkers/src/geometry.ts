import {
  CHINESE_CHECKERS_BOARD_RADIUS,
  CHINESE_CHECKERS_CAMP_OPTIONS,
  CHINESE_CHECKERS_CELL_COUNT,
} from "./constants.js";
import type { ChineseCheckersCamp } from "./types.js";

export type AxialCoordinate = Readonly<{ q: number; r: number }>;

const directions = [
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
] as const;

function key(coordinate: AxialCoordinate): string {
  return `${coordinate.q},${coordinate.r}`;
}

function add(
  coordinate: AxialCoordinate,
  direction: AxialCoordinate,
  amount: number,
): AxialCoordinate {
  return {
    q: coordinate.q + direction.q * amount,
    r: coordinate.r + direction.r * amount,
  };
}

function inCenter(coordinate: AxialCoordinate): boolean {
  const s = -coordinate.q - coordinate.r;
  return (
    Math.max(Math.abs(coordinate.q), Math.abs(coordinate.r), Math.abs(s)) <=
    CHINESE_CHECKERS_BOARD_RADIUS
  );
}

function campIndex(camp: ChineseCheckersCamp): number {
  return CHINESE_CHECKERS_CAMP_OPTIONS.indexOf(camp);
}

function buildCampCells(camp: ChineseCheckersCamp): readonly AxialCoordinate[] {
  const index = campIndex(camp);
  const outward = directions[index];
  const tangent = directions[(index + 2) % directions.length];
  if (outward === undefined || tangent === undefined) {
    throw new Error("Invalid Chinese Checkers camp direction.");
  }
  const cells: AxialCoordinate[] = [];
  for (let row = 0; row < 3; row += 1) {
    const base = add(
      { q: 0, r: 0 },
      outward,
      CHINESE_CHECKERS_BOARD_RADIUS + 1 + row,
    );
    for (let offset = 0; offset < 3 - row; offset += 1) {
      cells.push(add(base, tangent, offset));
    }
  }
  return Object.freeze(cells);
}

const campCoordinates = Object.freeze(
  Object.fromEntries(
    CHINESE_CHECKERS_CAMP_OPTIONS.map((camp) => [camp, buildCampCells(camp)]),
  ) as Record<ChineseCheckersCamp, readonly AxialCoordinate[]>,
);

const coordinateSet = new Map<string, AxialCoordinate>();
for (let q = -6; q <= 6; q += 1) {
  for (let r = -6; r <= 6; r += 1) {
    const coordinate = { q, r };
    if (inCenter(coordinate)) coordinateSet.set(key(coordinate), coordinate);
  }
}
for (const camp of CHINESE_CHECKERS_CAMP_OPTIONS) {
  for (const coordinate of campCoordinates[camp]) {
    coordinateSet.set(key(coordinate), coordinate);
  }
}

const coordinates = [...coordinateSet.values()].sort(
  (left, right) => left.r - right.r || left.q - right.q,
);
if (coordinates.length !== CHINESE_CHECKERS_CELL_COUNT) {
  throw new Error("Chinese Checkers geometry must contain 73 cells.");
}

export const CHINESE_CHECKERS_COORDINATES = Object.freeze(coordinates);
const indexByCoordinate = new Map(
  coordinates.map((coordinate, index) => [key(coordinate), index]),
);

export const CHINESE_CHECKERS_CAMP_CELLS = Object.freeze(
  Object.fromEntries(
    CHINESE_CHECKERS_CAMP_OPTIONS.map((camp) => [
      camp,
      Object.freeze(
        campCoordinates[camp].map((coordinate) => {
          const index = indexByCoordinate.get(key(coordinate));
          if (index === undefined)
            throw new Error("Camp cell is not on board.");
          return index;
        }),
      ),
    ]),
  ) as Record<ChineseCheckersCamp, readonly number[]>,
);

export const CHINESE_CHECKERS_CENTER_CELLS = Object.freeze(
  coordinates.flatMap((coordinate, index) =>
    inCenter(coordinate) ? [index] : [],
  ),
);

export function cellCoordinate(cell: number): AxialCoordinate | undefined {
  return CHINESE_CHECKERS_COORDINATES[cell];
}

export function cellIndex(coordinate: AxialCoordinate): number | undefined {
  return indexByCoordinate.get(key(coordinate));
}

export function adjacentCells(cell: number): readonly number[] {
  const coordinate = cellCoordinate(cell);
  if (coordinate === undefined) return [];
  const result: number[] = [];
  for (const direction of directions) {
    const index = cellIndex(add(coordinate, direction, 1));
    if (index !== undefined) result.push(index);
  }
  return result;
}

export function campForCell(cell: number): ChineseCheckersCamp | null {
  for (const camp of CHINESE_CHECKERS_CAMP_OPTIONS) {
    if (CHINESE_CHECKERS_CAMP_CELLS[camp].includes(cell)) return camp;
  }
  return null;
}

export function oppositeCamp(camp: ChineseCheckersCamp): ChineseCheckersCamp {
  return CHINESE_CHECKERS_CAMP_OPTIONS[(campIndex(camp) + 3) % 6] ?? "N";
}

export function jumpLanding(
  cell: number,
  directionIndex: number,
): {
  readonly over: number;
  readonly landing: number;
} | null {
  const coordinate = cellCoordinate(cell);
  const direction = directions[directionIndex];
  if (coordinate === undefined || direction === undefined) return null;
  const over = cellIndex(add(coordinate, direction, 1));
  const landing = cellIndex(add(coordinate, direction, 2));
  return over === undefined || landing === undefined ? null : { over, landing };
}

export const CHINESE_CHECKERS_DIRECTIONS = directions;
