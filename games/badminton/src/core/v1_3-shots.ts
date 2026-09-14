import { COURT, PHYSICS } from "../v1/constants-v1_3.js";
import type { BadmintonSide, BadmintonState } from "./v1_3-schemas.js";

type Shot = "CLEAR" | "DROP" | "SMASH";
type Flight = { shot: Shot; velocityX: number; velocityY: number };

export function shotDrag(shot: Shot | undefined): number {
  return shot === "CLEAR" ? PHYSICS.clearDragNumerator : PHYSICS.dragNumerator;
}

export function verticalStep(velocity: number): number {
  return Math.min(
    PHYSICS.maxFallSpeed,
    Math.trunc((velocity * PHYSICS.verticalDragNumerator) / 1000) +
      PHYSICS.shuttleGravity,
  );
}

export function hitsNet(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  clearance = 0,
): boolean {
  const padding = COURT.shuttleRadius + COURT.netWidth / 2;
  const left = COURT.netX - padding;
  const right = COURT.netX + padding;
  if (Math.max(x0, x1) < left || Math.min(x0, x1) > right) return false;
  const entryX = x0 < left ? left : x0 > right ? right : x0;
  const entryY =
    x1 === x0
      ? Math.max(y0, y1)
      : y0 + Math.trunc(((y1 - y0) * (entryX - x0)) / (x1 - x0));
  return Math.max(entryY, y1) + COURT.shuttleRadius + clearance >= COURT.netTop;
}

function horizontalVelocity(
  distance: number,
  ticks: number,
  drag: number,
): number | null {
  let low = 0;
  let high = 30_001;
  while (low < high) {
    const candidate = Math.floor((low + high) / 2);
    let velocity = candidate;
    let travel = 0;
    for (let tick = 0; tick < ticks; tick += 1) {
      velocity = Math.trunc((velocity * drag) / 1000);
      travel += velocity;
    }
    if (travel < Math.abs(distance)) low = candidate + 1;
    else high = candidate;
  }
  return low > 30_000 ? null : distance < 0 ? -low : low;
}

function verticalVelocity(distance: number, ticks: number): number {
  let low = -30_000;
  let high: number = PHYSICS.maxFallSpeed;
  while (low < high) {
    const candidate = Math.floor((low + high) / 2);
    let velocity = candidate;
    let travel = 0;
    for (let tick = 0; tick < ticks; tick += 1) {
      velocity = verticalStep(velocity);
      travel += velocity;
    }
    if (travel < distance) low = candidate + 1;
    else high = candidate;
  }
  return low;
}

function flight(
  shuttle: BadmintonState["shuttle"],
  shot: Shot,
  targetX: number,
  ticks: number,
): Flight | null {
  const velocityX = horizontalVelocity(
    targetX - shuttle.x,
    ticks,
    shotDrag(shot),
  );
  if (velocityX === null) return null;
  return {
    shot,
    velocityX,
    velocityY: verticalVelocity(
      COURT.ground - COURT.shuttleRadius - shuttle.y,
      ticks,
    ),
  };
}

// Use the same integer integration and four swept segments as live collision.
// A short shot must clear the whole net, not just its center line.
function clearsNet(
  shuttle: BadmintonState["shuttle"],
  launch: Flight,
  ticks: number,
  clearance: number,
): boolean {
  let { x, y } = shuttle;
  let { velocityX, velocityY } = launch;
  for (let tick = 0; tick < ticks; tick += 1) {
    velocityX = Math.trunc((velocityX * shotDrag(launch.shot)) / 1000);
    velocityY = verticalStep(velocityY);
    const startX = x;
    const startY = y;
    for (let part = 1; part <= 4; part += 1) {
      const nextX = startX + Math.trunc((velocityX * part) / 4);
      const nextY = startY + Math.trunc((velocityY * part) / 4);
      if (nextY < 0 || hitsNet(x, y, nextX, nextY, clearance)) return false;
      x = nextX;
      y = nextY;
    }
  }
  return true;
}

function clear(shuttle: BadmintonState["shuttle"], targetX: number): Flight {
  // The available height, rather than a fixed duration, sets the lift's arc.
  // Lower horizontal drag lets a steep lift retain enough depth to pass a camper.
  let low = 1;
  let high = 120;
  while (low < high) {
    const ticks = Math.ceil((low + high) / 2);
    let velocity = verticalVelocity(
      COURT.ground - COURT.shuttleRadius - shuttle.y,
      ticks,
    );
    let y = shuttle.y;
    let apex = y;
    for (let tick = 0; tick < ticks; tick += 1) {
      velocity = verticalStep(velocity);
      y += velocity;
      apex = Math.min(apex, y);
    }
    if (apex < Math.min(shuttle.y, PHYSICS.clearApex)) high = ticks - 1;
    else low = ticks;
  }
  const launch = flight(shuttle, "CLEAR", targetX, low);
  if (launch === null) throw new Error("Badminton clear exceeds launch speed.");
  return launch;
}

export function planShot(
  state: BadmintonState,
  side: BadmintonSide,
  serving: boolean,
): Flight {
  const player = state.athletes[side];
  const shuttle = state.shuttle;
  const facing = side === 0 ? 1 : -1;
  const mirror = (x: number) => (side === 0 ? x : COURT.width - x);
  if (!serving && player.swingShot === "DROP") {
    for (let ticks = 18; ticks <= 96; ticks += 1) {
      const launch = flight(shuttle, "DROP", mirror(600_000), ticks);
      if (
        launch !== null &&
        clearsNet(shuttle, launch, ticks, PHYSICS.dropNetClearance)
      )
        return launch;
    }
  }
  if (
    !serving &&
    player.swingShot === "SMASH" &&
    player.swingKind === "OVERHEAD" &&
    player.y <= COURT.ground - 45_000 &&
    shuttle.y <= player.y - PHYSICS.smashContactHeight &&
    shuttle.y <= COURT.netTop - PHYSICS.smashHeightAboveNet &&
    (shuttle.x - player.x) * facing >= 0 &&
    shuttle.velocityY >= 0
  ) {
    const aim = player.controls.move * facing;
    const target = aim > 0 ? 670_000 : aim < 0 ? 870_000 : 770_000;
    for (let ticks = 24; ticks <= 44; ticks += 1) {
      const launch = flight(shuttle, "SMASH", mirror(target), ticks);
      if (
        launch !== null &&
        launch.velocityY >= 0 &&
        clearsNet(shuttle, launch, ticks, PHYSICS.smashNetClearance)
      )
        return launch;
    }
  }
  return clear(shuttle, mirror(870_000));
}
