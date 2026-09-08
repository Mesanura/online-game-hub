export const COURT = Object.freeze({
  width: 1_000_000,
  height: 600_000,
  ground: 500_000,
  leftLine: 80_000,
  rightLine: 920_000,
  netX: 500_000,
  netTop: 340_000,
  netWidth: 6_000,
  shuttleRadius: 6_000,
  leftServeLine: 360_000,
  rightServeLine: 640_000,
  frontFootOffset: 20_000,
});

export const PHYSICS = Object.freeze({
  tickRate: 60,
  runSpeed: 5_500,
  jumpSpeed: 11_000,
  playerGravity: 500,
  shuttleGravity: 320,
  dragNumerator: 978,
  verticalDragNumerator: 985,
  maxFallSpeed: 18_000,
  racketOffsetX: 40_000,
  racketOffsetY: 95_000,
  racketRadiusX: 80_000,
  racketRadiusY: 90_000,
  swingDuration: 10,
  swingCooldown: 24,
  inputLease: 45,
  serveSwingDuration: 18,
  serveContactTick: 6,
  serveHandOffsetX: 40_000,
  serveHandOffsetY: 70_000,
  underhandHeight: 80_000,
  pointDelay: 90,
});

export function scoreLimit(target: 7 | 11 | 21): number {
  return target === 7 ? 11 : target === 11 ? 15 : 30;
}
