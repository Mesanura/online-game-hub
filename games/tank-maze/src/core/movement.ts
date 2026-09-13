import { DIRECTIONS } from "./directions.js";
import { clear, RADIUS, sweepCircle } from "./geometry.js";
import type { State, Tank, Wall } from "./schemas.js";

type Vector = { x: number; y: number };
type Contact = { t: number; nx: number; ny: number };
const skin = 1;
const contactMargin = 4;

function drive(tank: Tank): Vector {
  const direction = DIRECTIONS[tank.angle];
  if (direction === undefined) throw new Error("Invalid tank heading.");
  return {
    x: Math.round((direction[0] * tank.move * 2000) / 1000000),
    y: Math.round((direction[1] * tank.move * 2000) / 1000000),
  };
}

function wallNormals(point: Vector, walls: readonly Wall[]) {
  return walls.flatMap((wall) => {
    const x = point.x - Math.max(wall.x, Math.min(point.x, wall.x + wall.w));
    const y = point.y - Math.max(wall.y, Math.min(point.y, wall.y + wall.h));
    const length = Math.hypot(x, y);
    return length > 0 && length <= RADIUS + contactMargin
      ? [{ nx: x / length, ny: y / length }]
      : [];
  });
}

/** Public feedback is derived here, never from client-side collision guesses. */
export function isDrivingAgainstWall(tank: Tank, walls: readonly Wall[]) {
  if (!tank.alive || tank.move === 0) return false;
  const desired = drive(tank);
  return wallNormals(tank, walls).some(
    ({ nx, ny }) => desired.x * nx + desired.y * ny <= 0,
  );
}

/** Rounded rectangle sweep: faces and circular corners, including t=0 contact. */
function sweepBody(point: Vector, delta: Vector, wall: Wall): Contact | null {
  const candidates: Contact[] = [];
  const add = (t: number, nx: number, ny: number) => {
    if (t >= 0 && t <= 1 && delta.x * nx + delta.y * ny < -1e-8)
      candidates.push({ t, nx, ny });
  };
  for (const normal of wallNormals(point, [wall])) {
    const x = Math.max(wall.x, Math.min(point.x, wall.x + wall.w));
    const y = Math.max(wall.y, Math.min(point.y, wall.y + wall.h));
    if (Math.hypot(point.x - x, point.y - y) <= RADIUS)
      add(0, normal.nx, normal.ny);
  }
  for (const [edge, nx] of [
    [wall.x - RADIUS, -1],
    [wall.x + wall.w + RADIUS, 1],
  ] as const) {
    if (delta.x === 0) continue;
    const t = (edge - point.x) / delta.x;
    const y = point.y + delta.y * t;
    if (y >= wall.y && y <= wall.y + wall.h) add(t, nx, 0);
  }
  for (const [edge, ny] of [
    [wall.y - RADIUS, -1],
    [wall.y + wall.h + RADIUS, 1],
  ] as const) {
    if (delta.y === 0) continue;
    const t = (edge - point.y) / delta.y;
    const x = point.x + delta.x * t;
    if (x >= wall.x && x <= wall.x + wall.w) add(t, 0, ny);
  }
  for (const [x, sx] of [
    [wall.x, -1],
    [wall.x + wall.w, 1],
  ] as const)
    for (const [y, sy] of [
      [wall.y, -1],
      [wall.y + wall.h, 1],
    ] as const) {
      const t = sweepCircle(point.x, point.y, delta.x, delta.y, x, y, RADIUS);
      if (t === null) continue;
      const dx = point.x + delta.x * t - x;
      const dy = point.y + delta.y * t - y;
      const length = Math.hypot(dx, dy);
      if (dx * sx >= 0 && dy * sy >= 0 && length > 0)
        add(t, dx / length, dy / length);
    }
  return candidates.sort((a, b) => a.t - b.t)[0] ?? null;
}

function slide(
  members: readonly Tank[],
  desired: Vector,
  walls: readonly Wall[],
) {
  const offset = { x: 0, y: 0 };
  const delta = { ...desired };
  for (let iteration = 0; iteration < 8; iteration++) {
    const length = Math.hypot(delta.x, delta.y);
    if (length < 0.01) break;
    let earliest = 1;
    let contacts: Contact[] = [];
    for (const tank of members)
      for (const wall of walls) {
        const hit = sweepBody(
          { x: tank.x + offset.x, y: tank.y + offset.y },
          delta,
          wall,
        );
        if (hit === null) continue;
        if (hit.t < earliest - 1e-9) {
          earliest = hit.t;
          contacts = [hit];
        } else if (Math.abs(hit.t - earliest) <= 1e-9) contacts.push(hit);
      }
    if (contacts.length === 0) {
      offset.x += delta.x;
      offset.y += delta.y;
      break;
    }
    const travel = Math.max(0, earliest - skin / length);
    offset.x += delta.x * travel;
    offset.y += delta.y * travel;
    delta.x *= 1 - travel;
    delta.y *= 1 - travel;
    // Sorting removes wall-array order from simultaneous corner contacts.
    contacts.sort((a, b) => a.nx - b.nx || a.ny - b.ny);
    for (const { nx, ny } of contacts) {
      const inward = Math.min(0, delta.x * nx + delta.y * ny);
      delta.x -= inward * nx;
      delta.y -= inward * ny;
    }
  }
  const result = { x: Math.round(offset.x), y: Math.round(offset.y) };
  return members.every((tank) =>
    clear(tank.x + result.x, tank.y + result.y, RADIUS, walls),
  )
    ? result
    : { x: 0, y: 0 };
}

function align(tank: Tank, desired: Vector, walls: readonly Wall[]) {
  // Manual steering retains its full rate; a head-on stop has no preferred side.
  if (tank.turn !== 0 || tank.move === 0) return;
  const contacts = wallNormals(tank, walls);
  if (contacts.length === 0) return;
  const tangent = { ...desired };
  for (const { nx, ny } of contacts) {
    const inward = Math.min(0, tangent.x * nx + tangent.y * ny);
    tangent.x -= inward * nx;
    tangent.y -= inward * ny;
  }
  if (Math.hypot(tangent.x, tangent.y) < 1) return;
  let target = tank.angle;
  let best = -Infinity;
  DIRECTIONS.forEach(([x, y], angle) => {
    const dot = (x * tangent.x + y * tangent.y) * tank.move;
    if (dot > best) {
      best = dot;
      target = angle;
    }
  });
  const difference = ((target - tank.angle + 1080) % 720) - 360;
  tank.angle = (tank.angle + Math.max(-3, Math.min(3, difference)) + 720) % 720;
}

export function moveTanks(state: State): void {
  const live = state.tanks.filter((tank) => tank.alive);
  const desired = live.map((tank) => {
    if (tank.lease > 0) tank.lease--;
    else {
      tank.move = 0;
      tank.turn = 0;
    }
    const phase = (state.tick - 1) % 5;
    const rotation =
      Math.floor(((phase + 1) * 48) / 5) - Math.floor((phase * 48) / 5);
    tank.angle = (tank.angle + tank.turn * rotation + 720) % 720;
    return drive(tank);
  });
  const roots = live.map((_, index) => index);
  const root = (index: number): number => {
    const parent = roots[index];
    if (parent === undefined) throw new Error("Missing tank contact group.");
    return parent === index ? index : root(parent);
  };
  let proposals = new Map<number, Vector>();
  for (let pass = 0; pass < live.length; pass++) {
    const groups = new Map<number, number[]>();
    live.forEach((_, index) => {
      const group = root(index);
      groups.set(group, [...(groups.get(group) ?? []), index]);
    });
    proposals = new Map();
    for (const [group, indices] of groups) {
      const members = indices.map((index) => live[index] as Tank);
      const drivers = indices.filter((index) => live[index]?.move !== 0);
      const sum = drivers.reduce(
        (total, index) => ({
          x: total.x + (desired[index]?.x ?? 0),
          y: total.y + (desired[index]?.y ?? 0),
        }),
        { x: 0, y: 0 },
      );
      proposals.set(
        group,
        slide(
          members,
          {
            x: Math.round(sum.x / Math.max(1, drivers.length)),
            y: Math.round(sum.y / Math.max(1, drivers.length)),
          },
          state.arena.walls,
        ),
      );
    }
    const merges: [number, number][] = [];
    live.forEach((a, i) => {
      live.forEach((b, j) => {
        if (j <= i || root(i) === root(j)) return;
        const da = proposals.get(root(i));
        const db = proposals.get(root(j));
        if (da === undefined || db === undefined)
          throw new Error("Missing tank motion.");
        if (
          (a.x + da.x - b.x - db.x) ** 2 + (a.y + da.y - b.y - db.y) ** 2 <
          (2 * RADIUS) ** 2
        )
          merges.push([i, j]);
      });
    });
    if (merges.length === 0) break;
    for (const [i, j] of merges) roots[root(j)] = root(i);
  }
  live.forEach((tank, index) => {
    const delta = proposals.get(root(index));
    const intent = desired[index];
    if (delta === undefined || intent === undefined)
      throw new Error("Missing tank motion.");
    tank.x += delta.x;
    tank.y += delta.y;
    align(tank, intent, state.arena.walls);
  });
}
