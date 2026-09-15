import type { RealtimeGameDefinition } from "@online-game-hub/realtime-game-sdk";
import { ninjaClashManifest } from "../manifest.js";
import {
  configSchema,
  inputSchema,
  type Config,
  type Input,
  type State,
  type Fighter,
  type Outcome,
  type Effect,
} from "../contracts.js";
import {
  arena,
  body,
  blade,
  contacts,
  moveBody,
  overlaps,
} from "./geometry.js";
export { configSchema, inputSchema, outcomeSchema } from "../contracts.js";
export type { Config, Input, State, Outcome } from "../contracts.js";
function resetPlayer(
  p: Pick<Fighter, "slotId" | "index" | "score" | "resigned">,
  round: number,
  count: number,
): Fighter {
  const order = count === 2 ? [0, 1] : count === 3 ? [0, 1, 2] : [0, 1, 2, 3];
  const spawn = required(
    [
      [4800, 33600],
      [59200, 33600],
      [22400, 20800],
      [41600, 20800],
    ][order[(p.index + round - 1) % count] ?? 0],
  );
  return {
    ...p,
    x: required(spawn[0]),
    y: required(spawn[1]),
    vx: 0,
    vy: 0,
    gravityRemainder: 0,
    facing: required(spawn[0]) < 32000 ? 1 : -1,
    grounded: true,
    wall: 0,
    alive: !p.resigned,
    move: 0,
    leaseUntil: 0,
    coyoteUntil: 0,
    jumpUntil: -1,
    wallLockUntil: 0,
    attackStart: -100,
    attackFacing: 1,
    attackReady: 0,
    slideUntil: 0,
    slideReady: 0,
    slideFacing: 1,
  };
}
function effect(s: State, kind: Effect["kind"], p: Fighter): void {
  s.effects.push({
    id: s.nextEffect++,
    kind,
    x: p.x,
    y: p.y - 1200,
    until: s.tick + 18,
  });
}
function sliding(p: Fighter, t: number): boolean {
  return p.slideUntil > t;
}
function endSlide(p: Fighter, t: number): void {
  p.slideUntil = t;
  p.slideReady = t + 3;
}
function finish(
  s: State,
  winner: string | null,
  reason: Outcome["reason"],
): void {
  s.phase = "FINISHED";
  s.outcome = {
    type: winner === null ? "DRAW" : "WIN",
    winnerSlotId: winner,
    reason,
    standings: s.players.map((p) => ({
      slotId: p.slotId,
      score: p.score,
      resigned: p.resigned,
    })),
  };
}
function nextRound(s: State, winner: string | null): void {
  s.lastWinner = winner;
  s.round++;
  s.phase = "COUNTDOWN";
  s.countdown = 180;
  s.effects = s.effects.filter((e) => e.kind === "DEATH");
  s.players = s.players.map((p) => resetPlayer(p, s.round, s.players.length));
}
function strikeActive(p: Fighter, t: number): boolean {
  const age = t - p.attackStart;
  return p.alive && age >= 3 && age < 6;
}
function handle(p: Fighter, input: Input, s: State): void {
  const t = s.tick;
  if (!p.alive || p.resigned) return;
  switch (input.type) {
    case "MOVE":
      p.move = input.direction;
      p.leaseUntil = t + 30;
      if (p.move !== 0 && !sliding(p, t) && t >= p.wallLockUntil)
        p.facing = p.move;
      break;
    case "JUMP":
      if (!sliding(p, t)) p.jumpUntil = t + 6;
      break;
    case "ATTACK":
      if (t < p.attackReady) return;
      if (sliding(p, t)) endSlide(p, t);
      p.attackStart = t;
      p.attackFacing = p.facing;
      p.attackReady = t + 18;
      effect(s, "ATTACK", p);
      break;
    case "SLIDE":
      if (
        !p.grounded ||
        sliding(p, t) ||
        t < p.slideReady ||
        t - p.attackStart < 3
      )
        return;
      p.attackStart = -100;
      p.attackReady = t;
      p.slideUntil = t + 18;
      p.slideReady = t + 21;
      p.slideFacing = p.facing;
      p.jumpUntil = -1;
      effect(s, "SLIDE", p);
      break;
    case "RESIGN":
      break;
  }
}
function physics(p: Fighter, t: number): void {
  if (!p.alive) return;
  if (t >= p.leaseUntil) p.move = 0;
  contacts(p);
  if (p.grounded) p.coyoteUntil = t + 6;
  if (p.jumpUntil > t && !sliding(p, t)) {
    if (p.wall !== 0 && !p.grounded) {
      p.vx = -p.wall * 400;
      p.facing = p.wall === 1 ? -1 : 1;
      p.wallLockUntil = t + 6;
      p.vy = -600;
      p.gravityRemainder = 0;
      p.jumpUntil = -1;
      p.coyoteUntil = 0;
    } else if (p.grounded || p.coyoteUntil > t) {
      p.vy = -600;
      p.gravityRemainder = 0;
      p.jumpUntil = -1;
      p.coyoteUntil = 0;
    }
  }
  if (sliding(p, t)) p.vx = p.slideFacing * 600;
  else if (t >= p.wallLockUntil) p.vx = p.move * 300;
  if (!sliding(p, t) && t >= p.wallLockUntil && p.move !== 0) p.facing = p.move;
  p.gravityRemainder += 100;
  p.vy += Math.floor(p.gravityRemainder / 3);
  p.gravityRemainder %= 3;
  p.vy = Math.min(p.vy, 1000);
  if (p.wall !== 0 && p.move === p.wall && p.vy > 100 && !p.grounded)
    p.vy = 100;
  const blocked = moveBody(p);
  if (sliding(p, t) && (blocked || !p.grounded)) endSlide(p, t);
}
function project(state: State, selfSlotId: string) {
  return {
    tick: state.tick,
    round: state.round,
    phase: state.phase,
    countdown: state.countdown,
    targetScore: state.config.targetScore,
    lastWinner: state.lastWinner,
    selfSlotId,
    arena: {
      width: arena.width,
      height: arena.height,
      platforms: arena.platforms.map((r) => ({ ...r })),
    },
    players: state.players.map((p) => ({
      slotId: p.slotId,
      index: p.index,
      x: p.x,
      y: p.y,
      facing: p.facing,
      grounded: p.grounded,
      wall: p.wall,
      alive: p.alive,
      resigned: p.resigned,
      score: p.score,
      motion: sliding(p, state.tick)
        ? "SLIDE"
        : state.tick - p.attackStart < 6
          ? "ATTACK"
          : !p.grounded
            ? p.wall !== 0 && p.vy > 0
              ? "WALL"
              : p.vy < 0
                ? "RISE"
                : "FALL"
            : p.vx !== 0
              ? "RUN"
              : "IDLE",
      invulnerable: sliding(p, state.tick),
      attackAge: Math.min(18, Math.max(0, state.tick - p.attackStart)),
      attackFacing: p.attackFacing,
      attackCooldown: Math.max(0, p.attackReady - state.tick),
      slideCooldown: Math.max(0, p.slideReady - state.tick),
      blade: strikeActive(p, state.tick) ? blade(p) : null,
    })),
    effects: state.effects.map((e) => ({ ...e })),
    outcome: state.outcome,
  };
}
export type View = ReturnType<typeof project>;
export const ninjaClashDefinition = {
  manifest: ninjaClashManifest,
  configSchema,
  inputSchema,
  createInitialState({ config, players, rng }) {
    const parsed = configSchema.parse(config);
    if (
      players.length !== parsed.playerCount ||
      new Set(players).size !== players.length
    )
      throw new TypeError("Invalid participants");
    const fighters = players.map((slotId, index) =>
      resetPlayer(
        { slotId, index, score: 0, resigned: false },
        1,
        players.length,
      ),
    );
    return {
      state: {
        config: { ...parsed },
        tick: 0,
        round: 1,
        phase: "COUNTDOWN",
        countdown: 180,
        players: fighters,
        effects: [],
        nextEffect: 1,
        lastWinner: null,
        outcome: null,
      } as State,
      rng: { ...rng },
    };
  },
  step({ state, inputs, rng, tick }) {
    if (state.phase === "FINISHED") return { state, rng };
    const s: State = {
      ...state,
      tick,
      config: { ...state.config },
      players: state.players.map((p) => ({ ...p })),
      effects: state.effects
        .filter((e) => e.until > tick)
        .map((e) => ({ ...e })),
    };
    for (const event of inputs)
      if (event.input.type === "RESIGN") {
        const p = s.players.find((p) => p.slotId === event.slotId);
        if (p) {
          p.resigned = true;
          p.alive = false;
          p.move = 0;
        }
      }
    const remaining = s.players.filter((p) => !p.resigned);
    if (remaining.length <= 1)
      finish(s, remaining[0]?.slotId ?? null, "RESIGNATION");
    else if (s.phase === "COUNTDOWN") {
      s.countdown--;
      if (s.countdown === 0) s.phase = "ACTIVE";
    } else {
      for (const event of inputs) {
        const p = s.players.find((p) => p.slotId === event.slotId);
        if (p) handle(p, event.input, s);
      }
      for (const p of s.players) physics(p, tick);
      const attackers = s.players.filter((p) => strikeActive(p, tick));
      const clashed = new Set<string>();
      for (let i = 0; i < attackers.length; i++)
        for (let j = i + 1; j < attackers.length; j++) {
          const a = required(attackers[i]),
            b = required(attackers[j]);
          if (overlaps(blade(a), blade(b))) {
            clashed.add(a.slotId);
            clashed.add(b.slotId);
          }
        }
      for (const p of attackers)
        if (clashed.has(p.slotId)) {
          p.attackStart = -100;
          p.attackReady = tick + 3;
          effect(s, "CLASH", p);
        }
      const dead = new Set<string>();
      for (const a of attackers)
        if (!clashed.has(a.slotId))
          for (const b of s.players)
            if (
              b.alive &&
              a.slotId !== b.slotId &&
              !sliding(b, tick) &&
              overlaps(blade(a), body(b))
            )
              dead.add(b.slotId);
      for (const p of s.players)
        if (dead.has(p.slotId)) {
          p.alive = false;
          p.move = 0;
          effect(s, "DEATH", p);
        }
      const alive = s.players.filter((p) => p.alive);
      if (alive.length <= 1) {
        const winner = alive[0];
        if (winner) winner.score++;
        if (winner && winner.score >= s.config.targetScore)
          finish(s, winner.slotId, "TARGET_SCORE");
        else nextRound(s, winner?.slotId ?? null);
      }
    }
    s.tick = tick + 1;
    return { state: s, rng: { ...rng } };
  },
  projectView({ state, viewer }) {
    return project(state, viewer.slotId);
  },
  getOutcome(state) {
    return state.outcome;
  },
} satisfies RealtimeGameDefinition<Config, State, Input, View, Outcome>;

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected value to be present");
  return value;
}
