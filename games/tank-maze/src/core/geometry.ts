import type { Wall } from "./schemas.js";
export const UNIT = 1000;
export const RADIUS = 19000;
export function circleWall(x: number, y: number, r: number, w: Wall): boolean {
  const dx = x - Math.max(w.x, Math.min(x, w.x + w.w)),
    dy = y - Math.max(w.y, Math.min(y, w.y + w.h));
  return dx * dx + dy * dy < r * r;
}
export function clear(
  x: number,
  y: number,
  r: number,
  walls: readonly Wall[],
): boolean {
  return !walls.some((w) => circleWall(x, y, r, w));
}
/** Swept circle against expanded wall. Inclusive contact prevents thin-wall tunnelling. */
export function sweepWall(
  x: number,
  y: number,
  dx: number,
  dy: number,
  r: number,
  w: Wall,
): { t: number; nx: number; ny: number } | null {
  let enter = 0,
    leave = 1,
    nx = 0,
    ny = 0;
  for (const [p, d, lo, hi, ax, ay] of [
    [x, dx, w.x - r, w.x + w.w + r, 1, 0],
    [y, dy, w.y - r, w.y + w.h + r, 0, 1],
  ] as const) {
    if (d === 0) {
      if (p < lo || p > hi) return null;
      continue;
    }
    const a = (lo - p) / d,
      b = (hi - p) / d,
      near = Math.min(a, b),
      far = Math.max(a, b);
    if (near > enter) {
      enter = near;
      nx = d > 0 ? -ax : ax;
      ny = d > 0 ? -ay : ay;
    }
    leave = Math.min(leave, far);
    if (enter > leave) return null;
  }
  if (nx === 0 && ny === 0) return null;
  return enter >= 0 && enter <= 1 ? { t: enter, nx, ny } : null;
}
export function sweepCircle(
  x: number,
  y: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  r: number,
): number | null {
  const px = x - cx,
    py = y - cy,
    c = px * px + py * py - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy,
    b = 2 * (px * dx + py * dy),
    disc = b * b - 4 * a * c;
  if (a === 0 || disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
