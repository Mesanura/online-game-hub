export const COURT = Object.freeze({
  width: 600_000,
  height: 1_020_000,
  paddleRadius: 42_000,
  puckRadius: 18_000,
  centerRadius: 132_000,
  goalLeft: 216_000,
  goalRight: 384_000,
});

export const PHYSICS = Object.freeze({
  tickRate: 60 as const,
  paddleSpeed: 20_000,
  puckSpeed: 28_000,
  inputLease: 45,
  pointerScale: 10_000,
  eventLifetime: 60,
  maxEvents: 64,
  maxContacts: 16,
  separation: 2,
});
