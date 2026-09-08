import {
  nextRealtimeInt,
  type RealtimeRngState,
} from "@online-game-hub/realtime-game-sdk";
import type { Arena, Wall } from "./schemas.js";
export function generateArena(source: RealtimeRngState): {
  arena: Arena;
  rng: RealtimeRngState;
} {
  let rng = source;
  const random = (n: number) => {
    const pick = nextRealtimeInt(rng, n);
    rng = pick.next;
    return pick.value;
  };
  const cols = 8 + random(5),
    rows = 6 + random(4),
    count = cols * rows;
  const edges: {
    a: number;
    b: number;
    vertical: boolean;
  }[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const a = y * cols + x;
      if (x + 1 < cols) edges.push({ a, b: a + 1, vertical: true });
      if (y + 1 < rows) edges.push({ a, b: a + cols, vertical: false });
    }
  // Randomized spanning tree guarantees reachability; additional passages create loops.
  for (let i = edges.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [edges[i], edges[j]] = [required(edges[j]), required(edges[i])];
  }
  const roots = Array.from({ length: count }, (_, i) => i);
  const root = (i: number): number => {
    while (roots[i] !== i) i = required(roots[i]);
    return i;
  };
  const walls: Wall[] = [
    { x: 0, y: 0, w: cols * 100000, h: 8000 },
    { x: 0, y: rows * 100000 - 8000, w: cols * 100000, h: 8000 },
    { x: 0, y: 0, w: 8000, h: rows * 100000 },
    { x: cols * 100000 - 8000, y: 0, w: 8000, h: rows * 100000 },
  ];
  for (const edge of edges) {
    const a = root(edge.a),
      b = root(edge.b);
    if (a !== b) {
      roots[a] = b;
      continue;
    }
    if (random(100) < 28) continue;
    const x = edge.a % cols,
      y = Math.floor(edge.a / cols);
    walls.push(
      edge.vertical
        ? {
            x: (x + 1) * 100000 - 4000,
            y: y * 100000 - 4000,
            w: 8000,
            h: 108000,
          }
        : {
            x: x * 100000 - 4000,
            y: (y + 1) * 100000 - 4000,
            w: 108000,
            h: 8000,
          },
    );
  }
  // Optionally close one corner cell. The remaining spanning tree may split;
  // flood-fill below accepts it only if at least 85% of cells remain connected.
  if (random(2) === 1) {
    const corner = random(4),
      x = corner % 2 === 0 ? 0 : cols - 1,
      y = corner < 2 ? 0 : rows - 1;
    const extra: Wall[] = [
      {
        x: (x === 0 ? 1 : cols - 1) * 100000 - 4000,
        y: y * 100000 - 4000,
        w: 8000,
        h: 108000,
      },
      {
        x: x * 100000 - 4000,
        y: (y === 0 ? 1 : rows - 1) * 100000 - 4000,
        w: 108000,
        h: 8000,
      },
    ];
    const trial = [...walls, ...extra],
      main = largestRegion(cols, rows, trial);
    if (main.length >= Math.ceil(count * 0.85)) walls.push(...extra);
  }
  return {
    arena: {
      width: cols * 100000,
      height: rows * 100000,
      cols,
      rows,
      walls,
      cells: largestRegion(cols, rows, walls),
    },
    rng,
  };
}
function largestRegion(cols: number, rows: number, walls: Wall[]): number[] {
  const visited = new Set<number>();
  let largest: number[] = [];
  for (let i = 0; i < cols * rows; i++) {
    if (visited.has(i)) continue;
    const cells = [i];
    visited.add(i);
    for (let k = 0; k < cells.length; k++) {
      const a = required(cells[k]),
        x = a % cols,
        y = Math.floor(a / cols);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const xx = x + dx,
          yy = y + dy,
          b = yy * cols + xx;
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows || visited.has(b))
          continue;
        const mx = (x + 0.5 + dx * 0.5) * 100000,
          my = (y + 0.5 + dy * 0.5) * 100000;
        if (
          walls.some(
            (w) => mx >= w.x && mx <= w.x + w.w && my >= w.y && my <= w.y + w.h,
          )
        )
          continue;
        visited.add(b);
        cells.push(b);
      }
    }
    if (cells.length > largest.length) largest = cells;
  }
  return largest.sort((a, b) => a - b);
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required tank value is missing.");
  return value;
}
