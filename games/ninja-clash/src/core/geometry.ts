import type { Fighter, Rect } from "../contracts.js";
export const SCALE = 100;
export const arena = {
  width: 64000,
  height: 36000,
  platforms: [
    { x: 0, y: 0, w: 1600, h: 36000 },
    { x: 62400, y: 0, w: 1600, h: 36000 },
    { x: 0, y: 0, w: 64000, h: 1600 },
    { x: 0, y: 33600, w: 64000, h: 2400 },
    { x: 8000, y: 27200, w: 11200, h: 1600 },
    { x: 44800, y: 27200, w: 11200, h: 1600 },
    { x: 17600, y: 20800, w: 9600, h: 1600 },
    { x: 36800, y: 20800, w: 9600, h: 1600 },
    { x: 27200, y: 14400, w: 9600, h: 1600 },
  ],
};
export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}
export function body(p: Fighter): Rect {
  return { x: p.x - 600, y: p.y - 2400, w: 1200, h: 2400 };
}
export function blade(p: Fighter): Rect {
  const r = {
    x: p.attackFacing === 1 ? p.x + 600 : p.x - 3400,
    y: p.y - 2400,
    w: 2800,
    h: 2400,
  };
  for (const wall of arena.platforms) {
    if (r.y >= wall.y + wall.h || r.y + r.h <= wall.y) continue;
    if (p.attackFacing === 1 && wall.x >= p.x + 600)
      r.w = Math.min(r.w, Math.max(0, wall.x - r.x));
    if (p.attackFacing === -1 && wall.x + wall.w <= p.x - 600) {
      const edge = Math.max(r.x, wall.x + wall.w);
      r.w -= edge - r.x;
      r.x = edge;
    }
  }
  return r;
}
export function contacts(p: Fighter): void {
  const r = body(p);
  p.grounded = arena.platforms.some((w) => overlaps({ ...r, y: r.y + 1 }, w));
  p.wall = arena.platforms.some((w) => overlaps({ ...r, x: r.x - 1 }, w))
    ? -1
    : arena.platforms.some((w) => overlaps({ ...r, x: r.x + 1 }, w))
      ? 1
      : 0;
}
export function moveBody(p: Fighter): boolean {
  let dx = p.vx,
    dy = p.vy;
  const r = body(p);
  for (const w of arena.platforms)
    if (r.y < w.y + w.h && r.y + r.h > w.y) {
      if (dx > 0 && r.x + r.w <= w.x) dx = Math.min(dx, w.x - r.x - r.w);
      if (dx < 0 && r.x >= w.x + w.w) dx = Math.max(dx, w.x + w.w - r.x);
    }
  p.x += dx;
  const moved = body(p);
  for (const w of arena.platforms)
    if (moved.x < w.x + w.w && moved.x + moved.w > w.x) {
      if (dy > 0 && moved.y + moved.h <= w.y)
        dy = Math.min(dy, w.y - moved.y - moved.h);
      if (dy < 0 && moved.y >= w.y + w.h)
        dy = Math.max(dy, w.y + w.h - moved.y);
    }
  p.y += dy;
  if (dy !== p.vy) p.vy = 0;
  contacts(p);
  return dx !== p.vx;
}
