import {
  CHINESE_CHECKERS_CAMPS,
  type ChineseCheckersCellGeometry,
} from "./contracts";

const SPACING = 60;
const PADDING = 40;
const CELL_DIAMETER = 48;
const DIRECTIONS = [
  [0, -1],
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
] as const;

type Point = Readonly<{ x: number; y: number }>;

function crossProduct(origin: Point, left: Point, right: Point): number {
  return (
    (left.x - origin.x) * (right.y - origin.y) -
    (left.y - origin.y) * (right.x - origin.x)
  );
}

function hull(points: readonly Point[]): readonly Point[] {
  const sorted = [...points].sort(
    (left, right) => left.x - right.x || left.y - right.y,
  );
  const half = (ordered: readonly Point[]) => {
    const result: Point[] = [];
    for (const point of ordered) {
      while (result.length >= 2) {
        const previous = result.at(-2);
        const current = result.at(-1);
        if (
          previous === undefined ||
          current === undefined ||
          crossProduct(previous, current, point) > 0.001
        )
          break;
        result.pop();
      }
      result.push(point);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.toReversed())];
}

export function layoutBoard(
  geometry: readonly ChineseCheckersCellGeometry[],
  gameVersion: string,
) {
  if (gameVersion !== "1.0.0" && gameVersion !== "1.1.0") {
    throw new Error("Unsupported Chinese Checkers version.");
  }
  const raw = geometry.map((coordinate) =>
    gameVersion === "1.0.0"
      ? {
          x: (Math.sqrt(3) * coordinate.q) / 2,
          y: coordinate.r + coordinate.q / 2,
        }
      : {
          x: coordinate.q + coordinate.r / 2,
          y: (Math.sqrt(3) * coordinate.r) / 2,
        },
  );
  const minX = Math.min(...raw.map((point) => point.x));
  const minY = Math.min(...raw.map((point) => point.y));
  const width =
    (Math.max(...raw.map((point) => point.x)) - minX) * SPACING + PADDING * 2;
  const height =
    (Math.max(...raw.map((point) => point.y)) - minY) * SPACING + PADDING * 2;
  const cells = geometry.map((coordinate, cell) => {
    const point = raw[cell];
    if (point === undefined) throw new Error("Missing projected board cell.");
    return {
      ...coordinate,
      cell,
      x: PADDING + (point.x - minX) * SPACING,
      y: PADDING + (point.y - minY) * SPACING,
    };
  });
  const byCoordinate = new Map(
    cells.map((cell) => [`${cell.q},${cell.r}`, cell.cell]),
  );
  const connections = cells.flatMap((source) =>
    DIRECTIONS.flatMap(([columnStep, rowStep]) => {
      const target = byCoordinate.get(
        `${source.q + columnStep},${source.r + rowStep}`,
      );
      return target === undefined || target <= source.cell
        ? []
        : [{ from: source.cell, to: target }];
    }),
  );
  const rows = [...new Set(cells.map((cell) => cell.r))]
    .sort((left, right) => left - right)
    .map((rowCoordinate) => cells.filter((cell) => cell.r === rowCoordinate));
  const regions = [null, ...CHINESE_CHECKERS_CAMPS].map((camp) => ({
    camp,
    points: hull(cells.filter((cell) => cell.camp === camp)),
  }));
  return {
    width,
    height,
    cells,
    connections,
    rows,
    regions,
    cellDiameter: CELL_DIAMETER,
  };
}
