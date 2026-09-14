import { COURT, PHYSICS } from "./constants.js";
import type { AirHockeyImpact, AirHockeyState, Side } from "./schemas.js";

type Vector = { x: number; y: number };
type Body = Vector & { vx: number; vy: number };
type Edge = NonNullable<AirHockeyImpact["edge"]>;
type Contact = {
  time: number;
  priority: number;
  normal: Vector;
  kind: "WALL" | "PADDLE" | "GOAL";
  side: Side | null;
  edge: Edge | null;
  center: Vector | null;
  radius: number;
};
const EPSILON = 1e-8;
const SIDES = [0, 1] as const;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function magnitude(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function clampPaddle(point: Vector, side: Side): Vector {
  return {
    x: clamp(point.x, COURT.paddleRadius, COURT.width - COURT.paddleRadius),
    y:
      side === 0
        ? clamp(
            point.y,
            COURT.height / 2 + COURT.paddleRadius,
            COURT.height - COURT.paddleRadius,
          )
        : clamp(
            point.y,
            COURT.paddleRadius,
            COURT.height / 2 - COURT.paddleRadius,
          ),
  };
}

function movingPaddle(state: AirHockeyState, side: Side): Body {
  const paddle = state.paddles[side];
  const target = paddle.target ?? paddle;
  const dx = target.x - paddle.x;
  const dy = target.y - paddle.y;
  const distance = magnitude(dx, dy);
  const scale =
    distance > PHYSICS.paddleSpeed ? PHYSICS.paddleSpeed / distance : 1;
  return {
    x: paddle.x,
    y: paddle.y,
    vx: Math.trunc(dx * scale),
    vy: Math.trunc(dy * scale),
  };
}

export function emitImpact(
  state: AirHockeyState,
  tick: number,
  impact: Omit<AirHockeyImpact, "id" | "tick">,
): void {
  state.eventSequence += 1;
  state.events.push({
    ...impact,
    x: Math.round(impact.x),
    y: Math.round(impact.y),
    id: state.eventSequence,
    tick,
  });
  state.events = state.events.slice(-PHYSICS.maxEvents);
}

// All roots are solved from this tick's integer state; only the bounded
// intra-tick solver uses doubles. State and impulses are quantized on exit.
function circleTime(
  relative: Vector,
  velocity: Vector,
  radius: number,
  remaining: number,
): number | null {
  const c = relative.x ** 2 + relative.y ** 2 - radius ** 2;
  const b = relative.x * velocity.x + relative.y * velocity.y;
  if (c < -EPSILON) return 0;
  if (b >= -EPSILON) return null;
  if (c <= EPSILON) return 0;
  const a = velocity.x ** 2 + velocity.y ** 2;
  const discriminant = b * b - a * c;
  if (a <= EPSILON || discriminant < 0) return null;
  const time = (-b - Math.sqrt(discriminant)) / a;
  return time >= -EPSILON && time <= remaining + EPSILON
    ? clamp(time, 0, remaining)
    : null;
}

function nextContact(
  ball: Body,
  paddles: readonly [Body, Body],
  remaining: number,
  serverOnly: Side | null,
): Contact | null {
  let best: Contact | null = null;
  const add = (candidate: Contact) => {
    if (candidate.time < -EPSILON || candidate.time > remaining + EPSILON)
      return;
    candidate.time = clamp(candidate.time, 0, remaining);
    if (
      best === null ||
      candidate.time < best.time - EPSILON ||
      (Math.abs(candidate.time - best.time) <= EPSILON &&
        candidate.priority < best.priority)
    )
      best = candidate;
  };
  const plane = (axis: "x" | "y", limit: number, sign: number, edge: Edge) => {
    const position = ball[axis];
    const speed = axis === "x" ? ball.vx : ball.vy;
    const distance = (position - limit) * sign;
    const approach = speed * sign;
    if (distance >= -EPSILON && approach >= -EPSILON) return;
    const time = distance < 0 ? 0 : -distance / approach;
    if (axis === "y") {
      const x = ball.x + ball.vx * time;
      // Finite rails end at the posts. The circular caps cover glancing hits.
      if (x > COURT.goalLeft && x < COURT.goalRight) return;
    }
    add({
      time,
      priority: 0,
      normal: axis === "x" ? { x: sign, y: 0 } : { x: 0, y: sign },
      kind: "WALL",
      side: null,
      edge,
      center:
        axis === "x"
          ? { x: limit, y: ball.y + ball.vy * time }
          : { x: ball.x + ball.vx * time, y: limit },
      radius: 0,
    });
  };
  plane("x", COURT.puckRadius, 1, "LEFT");
  plane("x", COURT.width - COURT.puckRadius, -1, "RIGHT");
  plane("y", COURT.puckRadius, 1, "TOP");
  plane("y", COURT.height - COURT.puckRadius, -1, "BOTTOM");

  const circle = (
    body: Body,
    radius: number,
    side: Side | null,
    edge: Edge | null,
  ) => {
    const relative = { x: ball.x - body.x, y: ball.y - body.y };
    const velocity = { x: ball.vx - body.vx, y: ball.vy - body.vy };
    const time = circleTime(relative, velocity, radius, remaining);
    if (time === null) return;
    const dx = relative.x + velocity.x * time;
    const dy = relative.y + velocity.y * time;
    const length = magnitude(dx, dy);
    // A coincident center uses a fixed side-specific normal, never RNG.
    const normal =
      length > EPSILON
        ? { x: dx / length, y: dy / length }
        : { x: 0, y: side === 0 ? -1 : 1 };
    if (
      serverOnly !== null &&
      side !== null &&
      velocity.x * normal.x + velocity.y * normal.y >= -EPSILON
    )
      return;
    add({
      time,
      priority: side === null ? 0 : side + 1,
      normal,
      kind: side === null ? "WALL" : "PADDLE",
      side,
      edge,
      center: { x: body.x + body.vx * time, y: body.y + body.vy * time },
      radius,
    });
  };
  for (const y of [0, COURT.height]) {
    for (const x of [COURT.goalLeft, COURT.goalRight]) {
      circle(
        { x, y, vx: 0, vy: 0 },
        COURT.puckRadius,
        null,
        y === 0 ? "TOP" : "BOTTOM",
      );
    }
  }
  for (const side of SIDES) {
    if (serverOnly === null || serverOnly === side)
      circle(paddles[side], COURT.paddleRadius + COURT.puckRadius, side, null);
  }
  if (serverOnly === null || ball.vx !== 0 || ball.vy !== 0) {
    for (const side of SIDES) {
      const direction = side === 0 ? 1 : -1;
      if (ball.vy * direction <= 0) continue;
      const line =
        side === 0 ? COURT.height + COURT.puckRadius : -COURT.puckRadius;
      const time = (line - ball.y) / ball.vy;
      const x = ball.x + ball.vx * time;
      if (
        x - COURT.puckRadius < COURT.goalLeft ||
        x + COURT.puckRadius > COURT.goalRight
      )
        continue;
      add({
        time,
        priority: 3,
        normal: { x: 0, y: -direction },
        kind: "GOAL",
        side,
        edge: side === 0 ? "BOTTOM" : "TOP",
        center: null,
        radius: 0,
      });
    }
  }
  return best;
}

function advance(body: Body, time: number): void {
  body.x += body.vx * time;
  body.y += body.vy * time;
}

function capSpeed(ball: Body): void {
  const speed = magnitude(ball.vx, ball.vy);
  if (speed > PHYSICS.puckSpeed) {
    ball.vx *= PHYSICS.puckSpeed / speed;
    ball.vy *= PHYSICS.puckSpeed / speed;
  }
}

// If two kinematic paddles or a paddle and rail trap the puck, stop at
// contact instead of letting the requested paddle endpoint tunnel through it.
function separatePaddles(
  ball: Body,
  paddles: [Body, Body],
  serverOnly: Side | null,
): void {
  const radius = COURT.paddleRadius + COURT.puckRadius + PHYSICS.separation;
  for (const side of SIDES) {
    if (serverOnly !== null && side !== serverOnly) continue;
    const paddle = paddles[side];
    const dx = paddle.x - ball.x;
    const dy = paddle.y - ball.y;
    const distance = magnitude(dx, dy);
    if (distance >= radius) continue;
    const normal =
      distance > EPSILON
        ? { x: dx / distance, y: dy / distance }
        : { x: 0, y: side === 0 ? 1 : -1 };
    const separated = clampPaddle(
      { x: ball.x + normal.x * radius, y: ball.y + normal.y * radius },
      side,
    );
    paddle.x = separated.x;
    paddle.y = separated.y;
  }
}

export function simulate(state: AirHockeyState, tick: number): Side | null {
  const paddles: [Body, Body] = [
    movingPaddle(state, 0),
    movingPaddle(state, 1),
  ];
  const ball: Body = {
    x: state.puck.x,
    y: state.puck.y,
    vx: state.puck.velocityX,
    vy: state.puck.velocityY,
  };
  const serverOnly = state.phase === "SERVE" ? state.server : null;
  let remaining = 1;
  let goal: Side | null = null;
  for (
    let iteration = 0;
    iteration < PHYSICS.maxContacts && remaining > EPSILON;
    iteration++
  ) {
    const contact = nextContact(ball, paddles, remaining, serverOnly);
    const time = contact?.time ?? remaining;
    advance(ball, time);
    for (const paddle of paddles) advance(paddle, time);
    remaining -= time;
    if (contact === null) break;
    if (contact.kind === "GOAL") {
      goal = contact.side;
      emitImpact(state, tick, {
        kind: "GOAL",
        x: ball.x,
        y: contact.side === 0 ? COURT.height : 0,
        strength: 1000,
        side: contact.side === 0 ? 1 : 0,
        edge: contact.edge,
      });
      break;
    }
    const { normal, center } = contact;
    const paddle = contact.side === null ? null : paddles[contact.side];
    const relativeNormal =
      (ball.vx - (paddle?.vx ?? 0)) * normal.x +
      (ball.vy - (paddle?.vy ?? 0)) * normal.y;
    if (relativeNormal < -EPSILON) {
      ball.vx -= 2 * relativeNormal * normal.x;
      ball.vy -= 2 * relativeNormal * normal.y;
      capSpeed(ball);
      if (contact.kind === "PADDLE") state.phase = "RALLY";
      emitImpact(state, tick, {
        kind: contact.kind,
        x: ball.x - normal.x * COURT.puckRadius,
        y: ball.y - normal.y * COURT.puckRadius,
        strength: Math.max(
          1,
          Math.min(
            1000,
            Math.round((-relativeNormal * 1000) / PHYSICS.puckSpeed),
          ),
        ),
        side: contact.side,
        edge: contact.edge,
      });
    }
    if (center !== null) {
      ball.x = center.x + normal.x * (contact.radius + PHYSICS.separation);
      ball.y = center.y + normal.y * (contact.radius + PHYSICS.separation);
    }
  }
  if (remaining > EPSILON && goal === null) {
    // Conservatively settle a compressed contact manifold. No remaining
    // movement or synthetic bounce is invented when the iteration budget ends.
    ball.vx = 0;
    ball.vy = 0;
    ball.x = clamp(ball.x, COURT.puckRadius, COURT.width - COURT.puckRadius);
    if (
      ball.x < COURT.goalLeft + COURT.puckRadius ||
      ball.x > COURT.goalRight - COURT.puckRadius
    )
      ball.y = clamp(ball.y, COURT.puckRadius, COURT.height - COURT.puckRadius);
    separatePaddles(ball, paddles, serverOnly);
  }
  for (const side of SIDES) {
    state.paddles[side].x = Math.round(paddles[side].x);
    state.paddles[side].y = Math.round(paddles[side].y);
  }
  state.puck = {
    x: Math.round(ball.x),
    y: Math.round(ball.y),
    velocityX: Math.trunc(ball.vx),
    velocityY: Math.trunc(ball.vy),
  };
  return goal;
}
