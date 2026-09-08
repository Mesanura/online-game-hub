import type {
  RealtimeGameDefinition,
  RealtimePlayerInput,
  RealtimePlayerSlotId,
  RealtimeRngState,
} from "@online-game-hub/realtime-game-sdk";

import { COURT, PHYSICS, scoreLimit } from "../constants.js";
import { badmintonManifest } from "../manifest.js";
import {
  badmintonConfigSchema,
  badmintonInputSchema,
  badmintonStateSchema,
  type BadmintonConfig,
  type BadmintonControls,
  type BadmintonInput,
  type BadmintonOutcome,
  type BadmintonSide,
  type BadmintonState,
} from "./schemas.js";

export { COURT, PHYSICS, scoreLimit } from "../constants.js";
export { badmintonDefinitionV1_0_0 } from "./v1.js";
export {
  badmintonConfigSchema,
  badmintonInputSchema,
  badmintonStateSchema,
  badmintonOutcomeSchema,
} from "./schemas.js";
export type {
  BadmintonConfig,
  BadmintonControls,
  BadmintonInput,
  BadmintonOutcome,
  BadmintonState,
  BadmintonSide,
} from "./schemas.js";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function neutral(): BadmintonControls {
  return { move: 0, jump: false, serve: false, shot: "NONE" };
}

function other(side: BadmintonSide): BadmintonSide {
  return side === 0 ? 1 : 0;
}

function freshAthlete(side: BadmintonSide): BadmintonState["athletes"][number] {
  return {
    x: side === 0 ? 240_000 : 760_000,
    y: COURT.ground,
    velocityY: 0,
    controls: neutral(),
    inputAge: PHYSICS.inputLease,
    jumpHeld: false,
    serveHeld: false,
    moving: false,
    swingTicks: 0,
    cooldown: 0,
    swingShot: "NONE",
    hitThisSwing: false,
    swingKind: null,
    swingStartedTick: null,
    lastContact: null,
  };
}

function attachShuttle(state: BadmintonState): void {
  const player = state.athletes[state.server];
  state.shuttle = {
    x: player.x + (state.server === 0 ? 1 : -1) * PHYSICS.serveHandOffsetX,
    y: player.y - PHYSICS.serveHandOffsetY,
    velocityX: 0,
    velocityY: 0,
    lastHit: null,
  };
}

export function createInitialState(context: {
  readonly config: Readonly<BadmintonConfig>;
  readonly players: readonly RealtimePlayerSlotId[];
  readonly rng: Readonly<RealtimeRngState>;
}): { state: BadmintonState; rng: RealtimeRngState } {
  const config = badmintonConfigSchema.parse(context.config);
  const [left, right] = context.players;
  if (
    context.players.length !== 2 ||
    left === undefined ||
    right === undefined ||
    left === right
  ) {
    throw new Error("Badminton requires exactly two distinct player slots.");
  }
  const state: BadmintonState = {
    players: [left, right],
    targetScore: config.targetScore,
    tick: 0,
    phase: "SERVE",
    phaseTicks: 0,
    server: 0,
    athletes: [freshAthlete(0), freshAthlete(1)],
    shuttle: { x: 0, y: 0, velocityX: 0, velocityY: 0, lastHit: null },
    scores: [0, 0],
    rally: 1,
    rallyHits: 0,
    bestRally: 0,
    lastPoint: null,
    resignedSlotId: null,
  };
  attachShuttle(state);
  return {
    state: freeze(badmintonStateSchema.parse(state)),
    rng: { ...context.rng },
  };
}

function winningSide(state: Readonly<BadmintonState>): BadmintonSide | null {
  for (const side of [0, 1] as const) {
    const score = state.scores[side];
    if (
      score >= scoreLimit(state.targetScore) ||
      (score >= state.targetScore && score - state.scores[other(side)] >= 2)
    )
      return side;
  }
  return null;
}

export function getOutcome(
  state: Readonly<BadmintonState>,
): BadmintonOutcome | null {
  const scores: [number, number] = [...state.scores];
  if (state.resignedSlotId !== null) {
    return freeze({
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId:
        state.players[state.resignedSlotId === state.players[0] ? 1 : 0],
      resignedSlotId: state.resignedSlotId,
      scores,
    });
  }
  const winner = winningSide(state);
  return winner === null
    ? null
    : freeze({
        type: "WIN",
        reason: "SCORE",
        winnerSlotId: state.players[winner],
        scores,
      });
}

function applyInputs(
  state: BadmintonState,
  inputs: readonly RealtimePlayerInput<BadmintonInput>[],
): [boolean, boolean] {
  let previousIndex = -1;
  for (const change of inputs) {
    const index = state.players.indexOf(change.slotId);
    if (index < 0) throw new Error("Badminton input actor is not a player.");
    if (index <= previousIndex)
      throw new Error("Badminton inputs must have unique stable slot order.");
    previousIndex = index;
    const input = badmintonInputSchema.parse(change.input);
    if (input.type === "RESIGN") {
      state.resignedSlotId ??= change.slotId;
    } else {
      const player = state.athletes[index as BadmintonSide];
      player.controls = {
        move: input.move,
        jump: input.jump,
        serve: input.serve,
        shot: input.shot,
      };
      player.inputAge = 0;
    }
  }
  const servePressed: [boolean, boolean] = [false, false];
  for (const side of [0, 1] as const) {
    const player = state.athletes[side];
    if (player.inputAge >= PHYSICS.inputLease) player.controls = neutral();
    player.inputAge = Math.min(PHYSICS.inputLease, player.inputAge + 1);
    if (!player.controls.jump) player.jumpHeld = false;
    servePressed[side] = player.controls.serve && !player.serveHeld;
    player.serveHeld = player.controls.serve;
  }
  return servePressed;
}

function moveAthletes(state: BadmintonState): void {
  for (const side of [0, 1] as const) {
    const player = state.athletes[side];
    const holding =
      side === state.server &&
      (state.phase === "SERVE" || state.phase === "SERVING");
    const min = holding
      ? side === 0
        ? COURT.leftLine
        : COURT.rightServeLine + COURT.frontFootOffset
      : side === 0
        ? 30_000
        : COURT.netX + 35_000;
    const max = holding
      ? side === 0
        ? COURT.leftServeLine - COURT.frontFootOffset
        : COURT.rightLine
      : side === 0
        ? COURT.netX - 35_000
        : COURT.width - 30_000;
    const oldX = player.x;
    player.x = Math.max(
      min,
      Math.min(max, player.x + player.controls.move * PHYSICS.runSpeed),
    );
    player.moving = player.x !== oldX;
    if (player.controls.jump && !player.jumpHeld) {
      player.jumpHeld = true;
      if (player.y === COURT.ground) player.velocityY = -PHYSICS.jumpSpeed;
    }
    if (player.y < COURT.ground || player.velocityY < 0) {
      player.velocityY += PHYSICS.playerGravity;
      player.y = Math.min(COURT.ground, player.y + player.velocityY);
      if (player.y === COURT.ground) player.velocityY = 0;
    }
    player.swingTicks = Math.max(0, player.swingTicks - 1);
    player.cooldown = Math.max(0, player.cooldown - 1);
    if (!holding && player.controls.shot !== "NONE" && player.cooldown === 0) {
      player.swingTicks = PHYSICS.swingDuration;
      player.cooldown = PHYSICS.swingCooldown;
      player.swingShot = player.controls.shot;
      player.hitThisSwing = false;
      player.swingStartedTick = state.tick;
    }
    if (player.swingTicks > 0 && !player.hitThisSwing && !holding) {
      player.swingKind =
        state.shuttle.y > player.y - PHYSICS.underhandHeight
          ? "UNDERHAND"
          : "OVERHEAD";
    }
  }
}

// Solve the horizontal launch speed against the exact integer drag steps.
// The client supplies only a shot choice; it never chooses a trajectory.
function horizontalVelocity(distance: number, ticks: number): number {
  let low = 0;
  let high = 30_000;
  const target = Math.abs(distance);
  while (low < high) {
    const candidate = Math.floor((low + high) / 2);
    let velocity = candidate;
    let travel = 0;
    for (let tick = 0; tick < ticks; tick += 1) {
      velocity = Math.trunc((velocity * PHYSICS.dragNumerator) / 1000);
      travel += velocity;
    }
    if (travel < target) low = candidate + 1;
    else high = candidate;
  }
  return distance < 0 ? -low : low;
}

function verticalVelocity(distance: number, ticks: number): number {
  let low = -30_000;
  let high: number = PHYSICS.maxFallSpeed;
  while (low < high) {
    const candidate = Math.floor((low + high) / 2);
    let velocity = candidate;
    let travel = 0;
    for (let tick = 0; tick < ticks; tick += 1) {
      velocity = Math.min(
        PHYSICS.maxFallSpeed,
        Math.trunc((velocity * PHYSICS.verticalDragNumerator) / 1000) +
          PHYSICS.shuttleGravity,
      );
      travel += velocity;
    }
    if (travel < distance) low = candidate + 1;
    else high = candidate;
  }
  return low;
}

function strike(
  state: BadmintonState,
  side: BadmintonSide,
  serving = false,
): void {
  const player = state.athletes[side];
  if (!serving)
    player.swingKind =
      state.shuttle.y > player.y - PHYSICS.underhandHeight
        ? "UNDERHAND"
        : "OVERHEAD";
  const shot = serving
    ? "CLEAR"
    : player.swingShot === "SMASH" &&
        (player.swingKind === "UNDERHAND" ||
          player.y > COURT.ground - 45_000 ||
          state.shuttle.y > COURT.netTop - 30_000)
      ? "CLEAR"
      : player.swingShot === "DROP"
        ? "DROP"
        : player.swingShot === "SMASH"
          ? "SMASH"
          : "CLEAR";
  const flightTicks = shot === "SMASH" ? 26 : shot === "DROP" ? 68 : 86;
  const target =
    shot === "DROP" ? 620_000 : shot === "SMASH" ? 770_000 : 830_000;
  const targetX = side === 0 ? target : COURT.width - target;
  state.shuttle.velocityX = horizontalVelocity(
    targetX - state.shuttle.x,
    flightTicks,
  );
  state.shuttle.velocityY = verticalVelocity(
    COURT.ground - COURT.shuttleRadius - state.shuttle.y,
    flightTicks,
  );
  state.shuttle.lastHit = side;
  state.rallyHits += 1;
  state.bestRally = Math.max(state.bestRally, state.rallyHits);
  player.hitThisSwing = true;
  player.swingShot = shot;
  player.lastContact = {
    tick: state.tick,
    x: state.shuttle.x,
    y: state.shuttle.y,
    shot,
  };
}

function canHit(state: BadmintonState, side: BadmintonSide): boolean {
  const player = state.athletes[side];
  if (
    player.swingTicks === 0 ||
    player.hitThisSwing ||
    state.shuttle.lastHit === side
  )
    return false;
  if (
    side === 0 ? state.shuttle.x >= COURT.netX : state.shuttle.x <= COURT.netX
  )
    return false;
  const facing = side === 0 ? 1 : -1;
  const dx = Math.trunc(
    ((state.shuttle.x - player.x - facing * PHYSICS.racketOffsetX) * 1000) /
      PHYSICS.racketRadiusX,
  );
  const dy = Math.trunc(
    ((state.shuttle.y - player.y + PHYSICS.racketOffsetY) * 1000) /
      PHYSICS.racketRadiusY,
  );
  return dx * dx + dy * dy <= 1_000_000;
}

function awardPoint(
  state: BadmintonState,
  winner: BadmintonSide,
  reason: NonNullable<BadmintonState["lastPoint"]>["reason"],
): void {
  state.scores[winner] += 1;
  state.server = winner;
  state.lastPoint = { winner, reason, x: state.shuttle.x, y: state.shuttle.y };
  state.shuttle.velocityX = 0;
  state.shuttle.velocityY = 0;
  for (const player of state.athletes) player.moving = false;
  state.phase = winningSide(state) === null ? "POINT" : "FINISHED";
  state.phaseTicks = state.phase === "POINT" ? PHYSICS.pointDelay : 0;
}

function hitsNet(x0: number, y0: number, x1: number, y1: number): boolean {
  const padding = COURT.shuttleRadius + COURT.netWidth / 2;
  const left = COURT.netX - padding;
  const right = COURT.netX + padding;
  if (Math.max(x0, x1) < left || Math.min(x0, x1) > right) return false;
  const entryX = x0 < left ? left : x0 > right ? right : x0;
  const entryY =
    x1 === x0
      ? Math.max(y0, y1)
      : y0 + Math.trunc(((y1 - y0) * (entryX - x0)) / (x1 - x0));
  return Math.max(entryY, y1) + COURT.shuttleRadius >= COURT.netTop;
}

function flyShuttle(state: BadmintonState): void {
  const shuttle = state.shuttle;
  shuttle.velocityX = Math.trunc(
    (shuttle.velocityX * PHYSICS.dragNumerator) / 1000,
  );
  shuttle.velocityY = Math.min(
    PHYSICS.maxFallSpeed,
    Math.trunc((shuttle.velocityY * PHYSICS.verticalDragNumerator) / 1000) +
      PHYSICS.shuttleGravity,
  );
  const startX = shuttle.x;
  const startY = shuttle.y;
  // Four swept segments prevent fast smashes tunnelling through the net or racket.
  for (let part = 1; part <= 4; part += 1) {
    const previousX = shuttle.x;
    const previousY = shuttle.y;
    shuttle.x = startX + Math.trunc((shuttle.velocityX * part) / 4);
    shuttle.y = startY + Math.trunc((shuttle.velocityY * part) / 4);
    const faultWinner = other(shuttle.lastHit ?? state.server);
    if (hitsNet(previousX, previousY, shuttle.x, shuttle.y)) {
      awardPoint(state, faultWinner, "NET");
      return;
    }
    if (shuttle.y + COURT.shuttleRadius >= COURT.ground) {
      // Judge the actual line crossing, not the overshot end-of-tick position.
      shuttle.x =
        previousX +
        Math.trunc(
          ((shuttle.x - previousX) *
            (COURT.ground - COURT.shuttleRadius - previousY)) /
            Math.max(1, shuttle.y - previousY),
        );
      shuttle.y = COURT.ground - COURT.shuttleRadius;
      if (shuttle.x < COURT.leftLine || shuttle.x > COURT.rightLine)
        awardPoint(state, faultWinner, "OUT");
      else awardPoint(state, shuttle.x < COURT.netX ? 1 : 0, "GROUND");
      return;
    }
    if (shuttle.x < 0 || shuttle.x > COURT.width || shuttle.y < 0) {
      awardPoint(state, faultWinner, "OUT");
      return;
    }
    for (const side of [0, 1] as const) {
      if (canHit(state, side)) {
        strike(state, side);
        return;
      }
    }
  }
}

export function step(context: {
  readonly state: Readonly<BadmintonState>;
  readonly tick: number;
  readonly inputs: readonly RealtimePlayerInput<BadmintonInput>[];
  readonly rng: Readonly<RealtimeRngState>;
}): { state: BadmintonState; rng: RealtimeRngState } {
  const state = badmintonStateSchema.parse(context.state);
  if (getOutcome(state) !== null || state.phase === "FINISHED")
    throw new Error("Badminton match is already finished.");
  if (context.tick !== state.tick)
    throw new Error("Badminton tick is not contiguous.");
  const servePressed = applyInputs(state, context.inputs);
  state.tick += 1;
  if (state.resignedSlotId !== null) {
    state.phase = "FINISHED";
    state.phaseTicks = 0;
  } else if (state.phase === "POINT") {
    state.phaseTicks -= 1;
    if (state.phaseTicks <= 0) {
      state.phase = "SERVE";
      state.phaseTicks = 0;
      state.rally += 1;
      state.rallyHits = 0;
      state.athletes = state.athletes.map((player, side) => ({
        ...freshAthlete(side as BadmintonSide),
        controls: player.controls,
        inputAge: player.inputAge,
        jumpHeld: player.jumpHeld,
        serveHeld: player.serveHeld,
      })) as BadmintonState["athletes"];
      attachShuttle(state);
    }
  } else {
    moveAthletes(state);
    if (state.phase === "SERVE") {
      attachShuttle(state);
      if (servePressed[state.server]) {
        const player = state.athletes[state.server];
        state.phase = "SERVING";
        player.swingKind = "SERVE";
        player.swingStartedTick = state.tick;
        player.swingTicks = PHYSICS.serveSwingDuration;
        player.cooldown = PHYSICS.swingCooldown;
        player.swingShot = "CLEAR";
        player.hitThisSwing = false;
      }
    }
    if (state.phase === "SERVING") {
      attachShuttle(state);
      state.phaseTicks =
        state.tick -
        (state.athletes[state.server].swingStartedTick ?? state.tick) +
        1;
      if (state.phaseTicks >= PHYSICS.serveContactTick) {
        state.phase = "RALLY";
        state.phaseTicks = 0;
        strike(state, state.server, true);
      }
    } else if (state.phase === "RALLY") flyShuttle(state);
  }
  return { state: freeze(state), rng: { ...context.rng } };
}

function projectAthlete(player: BadmintonState["athletes"][number]) {
  return {
    x: player.x,
    y: player.y,
    moving: player.moving,
    swingTicks: player.swingTicks,
    swingShot: player.swingShot,
    swingKind: player.swingKind,
    swingStartedTick: player.swingStartedTick,
    lastContact: player.lastContact === null ? null : { ...player.lastContact },
  };
}

export function projectView(context: {
  readonly state: Readonly<BadmintonState>;
  readonly viewer: {
    readonly kind: "player";
    readonly slotId: RealtimePlayerSlotId;
  };
}) {
  const state = context.state;
  const ownIndex = state.players.indexOf(context.viewer.slotId);
  return freeze({
    court: { ...COURT },
    players: state.players.map((slotId, side) => ({
      slotId,
      side: side === 0 ? "LEFT" : "RIGHT",
    })) as [
      { slotId: string; side: "LEFT" },
      { slotId: string; side: "RIGHT" },
    ],
    athletes: state.athletes.map(projectAthlete) as [
      ReturnType<typeof projectAthlete>,
      ReturnType<typeof projectAthlete>,
    ],
    shuttle: { x: state.shuttle.x, y: state.shuttle.y },
    scores: [...state.scores] as [number, number],
    targetScore: state.targetScore,
    scoreCap: scoreLimit(state.targetScore),
    tick: state.tick,
    phase: state.phase,
    phaseTicks: state.phaseTicks,
    servingSide: state.server === 0 ? ("LEFT" as const) : ("RIGHT" as const),
    yourSide:
      ownIndex < 0
        ? null
        : ownIndex === 0
          ? ("LEFT" as const)
          : ("RIGHT" as const),
    rally: state.rally,
    rallyHits: state.rallyHits,
    bestRally: state.bestRally,
    lastPoint: state.lastPoint === null ? null : { ...state.lastPoint },
    outcome: getOutcome(state),
  });
}

export type BadmintonView = ReturnType<typeof projectView>;

export const badmintonDefinition = Object.freeze({
  manifest: badmintonManifest,
  configSchema: badmintonConfigSchema,
  inputSchema: badmintonInputSchema,
  createInitialState,
  step,
  projectView,
  getOutcome,
}) satisfies RealtimeGameDefinition<
  BadmintonConfig,
  BadmintonState,
  BadmintonInput,
  BadmintonView,
  BadmintonOutcome
>;
