export const TILE_PIXELS = 32;
export const PLAYER_COLORS = [
  "#42a7e5",
  "#ed7085",
  "#edb943",
  "#9478df",
] as const;
const PLAYER_SHADES = ["#2875b1", "#b54c69", "#b7832b", "#6352aa"] as const;
export type PixelSprite = {
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
};
const normalized = (rows: readonly string[]) =>
  rows.map((row) => row.padEnd(16, ".").slice(0, 16));
export const floorSprite = (alternate = false): PixelSprite => ({
  rows: Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) =>
      (x === 4 && y === 5) || (x === 12 && y === 12)
        ? "b"
        : (x === 5 && y === 5) || (x === 13 && y === 12)
          ? "c"
          : "a",
    ).join(""),
  ),
  palette: { a: alternate ? "#c4d99f" : "#bcd297", b: "#afc48c", c: "#d7e6b9" },
});
export const wallSprite: PixelSprite = {
  rows: normalized([
    "0000000000000000",
    "0111111111111120",
    "0133333333333420",
    "0134444444445420",
    "0134444444445420",
    "0134441444445420",
    "0134444444445420",
    "0134444444445420",
    "0134444444445420",
    "0134444444445420",
    "0134444444445420",
    "0135555555555420",
    "0144444444444420",
    "0155555555555520",
    "0222222222222220",
    "0000000000000000",
  ]),
  palette: {
    "0": "#34485b",
    "1": "#d8e7dc",
    "2": "#536e7a",
    "3": "#bbcfc5",
    "4": "#94ada8",
    "5": "#7a9596",
  },
};
export const brickSprite: PixelSprite = {
  rows: Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) =>
      x === 0 || y === 0 || x === 15 || y === 15
        ? "d"
        : y === 7 || (y < 7 ? x === 8 : x === 4)
          ? "s"
          : y === 1 || y === 8
            ? "h"
            : y === 6 || y === 14
              ? "s"
              : "b",
    ).join(""),
  ),
  palette: { d: "#704645", s: "#a35949", h: "#f3b17a", b: "#d8875b" },
};
export function bombSprite(hot = false): PixelSprite {
  return {
    rows: normalized([
      "................",
      "..........yy....",
      ".........y......",
      ".......ddo......",
      ".....dddddd.....",
      "....dHHdddddd...",
      "...dHHHddddddd..",
      "...dHHdddddddd..",
      "...ddddddddddd..",
      "...dddddDddddd..",
      "...ddddDDDdddd..",
      "....dddDDDddd...",
      ".....ddddddd....",
      "......ddddd.....",
      "................",
      "................",
    ]),
    palette: {
      d: hot ? "#ae4f59" : "#28364c",
      D: hot ? "#7e3d51" : "#1c273c",
      H: "#a3b5be",
      o: "#f89044",
      y: "#ffe889",
    },
  };
}
export type FlameShape = "center" | "horizontal" | "vertical" | "intersection";
export function flameSprite(
  frame: number,
  shape: FlameShape = "center",
): PixelSprite {
  return {
    rows: Array.from({ length: 16 }, (_, y) =>
      Array.from({ length: 16 }, (_, x) => {
        const dx = Math.abs(x - 7.5);
        const dy = Math.abs(y - 7.5);
        const edge =
          shape === "horizontal"
            ? dy
            : shape === "vertical"
              ? dx
              : Math.min(dx, dy);
        if (edge > 4 || (edge > 3 && (x + y + frame) % 3 === 0)) return ".";
        return edge < 1.6 ? "w" : edge < 3 ? "y" : "o";
      }).join(""),
    ),
    palette: {
      w: "#fff7c3",
      y: frame === 0 ? "#ffcf55" : "#ffdf70",
      o: "#ef793c",
    },
  };
}
export function pickupSprite(
  kind: "capacity" | "range" | "speed",
): PixelSprite {
  const rows: string[][] = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) =>
      x < 1 || y < 1 || x > 14 || y > 14
        ? "."
        : x === 1 || x === 14 || y === 1 || y === 14
          ? "d"
          : y === 2
            ? "h"
            : "b",
    ),
  );
  const glyph =
    kind === "capacity"
      ? [
          "....c...",
          "...ccc..",
          "..cccc..",
          ".ccccc..",
          ".ccccc..",
          "..ccc...",
          "......++",
          ".......+",
        ]
      : kind === "range"
        ? [
            "...c....",
            "..ccc...",
            "..ccc.c.",
            ".cccccc.",
            ".cccccc.",
            "..cccc..",
            "..cccc..",
            "...cc...",
          ]
        : [
            "....ccc.",
            "...ccc..",
            "..ccc...",
            ".cccccc.",
            "...ccc..",
            "..ccc...",
            ".ccc....",
            ".cc.....",
          ];
  for (const [y, row] of glyph.entries())
    for (const [x, cell] of [...row].entries())
      if (cell !== ".") {
        const target = rows[y + 4];
        if (target) target[x + 4] = cell;
      }
  return {
    rows: rows.map((row) => row.join("")),
    palette: {
      d: "#6e735e",
      h: "#fffef1",
      b: "#fff1bf",
      c:
        kind === "capacity"
          ? "#365a89"
          : kind === "range"
            ? "#e87241"
            : "#ba9230",
      "+": "#43a370",
    },
  };
}
export function playerSprite(index: number, frame: number): PixelSprite {
  // Centered 10×10 footprint in a 16×16 canvas: no offset feet or directional
  // silhouette changes. Every animation frame is bilaterally symmetric.
  const rows = normalized([
    "................",
    "................",
    "................",
    "......0000......",
    "....00cccc00....",
    "...0cccccccc0...",
    "...0cwwwwwwc0...",
    "...0cw0ww0wc0...",
    "...0cw0ww0wc0...",
    "...0cwwwwwwc0...",
    "...0cccccccc0...",
    "....00CCCC00....",
    "......0000......",
    "................",
    "................",
    "................",
  ]);
  if (frame === 1) {
    rows[4] = "....00CCCC00....";
    rows[11] = "....00cccc00....";
  }
  const color = index % PLAYER_COLORS.length;
  return {
    rows,
    palette: {
      "0": "#2e3d55",
      w: "#fffbea",
      c: PLAYER_COLORS[color] ?? PLAYER_COLORS[0],
      C: PLAYER_SHADES[color] ?? PLAYER_SHADES[0],
    },
  };
}
export function paintPixels(
  context: CanvasRenderingContext2D,
  sprite: PixelSprite,
  scale = 1,
  offsetX = 0,
  offsetY = 0,
): void {
  context.imageSmoothingEnabled = false;
  sprite.rows.forEach((row, y) =>
    [...row].forEach((pixel, x) => {
      const color = sprite.palette[pixel];
      if (color) {
        context.fillStyle = color;
        context.fillRect(
          offsetX + x * scale,
          offsetY + y * scale,
          scale,
          scale,
        );
      }
    }),
  );
}
