import {
  nextRealtimeInt,
  type RealtimeGameDefinition,
  type RealtimeRngState,
} from "@online-game-hub/realtime-game-sdk";
// Frozen 1.1.0 simulation: historical records retain their movement and maps.
import { tankMazeManifestV1_1_0 } from "../manifest.js";
import { DIRECTIONS } from "./directions.js";
import { clear, RADIUS, sweepCircle, sweepWall } from "./geometry.js";
import { generateArena } from "./map-v1_1.js";
import { createMissileNavigator } from "./navigation.js";
import {
  configSchema,
  inputSchema,
  type State,
  type Config,
  type Input,
  type Outcome,
  type Tank,
  type Bullet,
  type PickupKind,
} from "./schemas.js";
const unit = (angle: number) =>
  required(DIRECTIONS[((angle % 720) + 720) % 720]);
const vector = (angle: number, speed: number) => {
  const [x, y] = unit(angle);
  return [
    Math.round((x * speed) / 1000000),
    Math.round((y * speed) / 1000000),
  ] as const;
};
const distance = (
  a: {
    x: number;
    y: number;
  },
  b: {
    x: number;
    y: number;
  },
) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
function emit(
  s: State,
  kind: State["events"][number]["kind"],
  x: number,
  y: number,
) {
  s.events.push({ id: s.nextId++, kind, x, y });
}
function result(
  s: State,
  winner: string | null,
  reason: Outcome["reason"],
): void {
  s.outcome = {
    type: winner === null ? "DRAW" : "WIN",
    winnerSlotId: winner,
    reason,
    scores: s.tanks.map((t) => ({ slotId: t.slotId, score: t.score })),
  };
  s.phase = "COMPLETE";
}
function resetBout(s: State, source: RealtimeRngState): RealtimeRngState {
  const generated = generateArena(source);
  s.arena = generated.arena;
  let rng = generated.rng;
  const roll = nextRealtimeInt(rng, s.arena.cells.length);
  rng = roll.next;
  const chosen: number[] = [];
  for (const tank of s.tanks) {
    if (tank.resigned) {
      tank.alive = false;
      continue;
    }
    let best = required(s.arena.cells[roll.value]),
      bestScore = -1;
    for (const cell of s.arena.cells) {
      if (chosen.includes(cell)) continue;
      const x = ((cell % s.arena.cols) + 0.5) * 100000,
        y = (Math.floor(cell / s.arena.cols) + 0.5) * 100000;
      let score = chosen.length === 0 ? (cell === best ? 1 : 0) : Infinity;
      for (const c of chosen) {
        const cx = ((c % s.arena.cols) + 0.5) * 100000,
          cy = (Math.floor(c / s.arena.cols) + 0.5) * 100000;
        const blocked = s.arena.walls.some(
          (w) => sweepWall(x, y, cx - x, cy - y, 0, w) !== null,
        );
        score = Math.min(
          score,
          (x - cx) ** 2 + (y - cy) ** 2 + (blocked ? 1e12 : 0),
        );
      }
      if (score > bestScore) {
        bestScore = score;
        best = cell;
      }
    }
    chosen.push(best);
    tank.x = ((best % s.arena.cols) + 0.5) * 100000;
    tank.y = (Math.floor(best / s.arena.cols) + 0.5) * 100000;
    const heading = nextRealtimeInt(rng, 720);
    rng = heading.next;
    tank.angle = heading.value;
    tank.alive = true;
    tank.weapon = "normal";
    tank.ammo = 0;
    tank.shield = 0;
    tank.move = 0;
    tank.turn = 0;
    tank.lease = 0;
  }
  s.bullets = [];
  s.pickups = [];
  s.phase = "PREPARE";
  s.phaseTicks = 180;
  s.elapsed = 0;
  s.nextPickup = 300;
  s.bout++;
  return rng;
}
function moveTanks(s: State): void {
  const live = s.tanks.filter((t) => t.alive);
  const desired = live.map((t) => {
    if (t.lease > 0) t.lease--;
    else {
      t.move = 0;
      t.turn = 0;
    }
    // Distribute 48 half-degree steps over five ticks: exactly one turn in 75 ticks.
    const turnPhase = (s.tick - 1) % 5;
    const rotation =
      Math.floor(((turnPhase + 1) * 48) / 5) - Math.floor((turnPhase * 48) / 5);
    t.angle = (t.angle + t.turn * rotation + 720) % 720;
    return vector(t.angle, t.move === 1 ? 2000 : t.move === -1 ? -1083 : 0);
  });
  // Resolve connected contact groups simultaneously; stationary tanks are pushed,
  // opposing drivers cancel. No slot gets first-writer priority.
  const roots = live.map((_, i) => i);
  const root = (i: number): number => {
    while (roots[i] !== i) i = required(roots[i]);
    return i;
  };
  for (let pass = 0; pass < live.length; pass++) {
    const proposals = live.map((_, i) => {
      const members = live.map((__, j) => j).filter((j) => root(j) === root(i));
      const drivers = members.filter(
        (j) => required(desired[j])[0] !== 0 || required(desired[j])[1] !== 0,
      );
      return drivers.length === 0
        ? [0, 0]
        : [
            Math.round(
              drivers.reduce((a, j) => a + required(desired[j])[0], 0) /
                drivers.length,
            ),
            Math.round(
              drivers.reduce((a, j) => a + required(desired[j])[1], 0) /
                drivers.length,
            ),
          ];
    });
    let merged = false;
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        if (root(i) === root(j)) continue;
        const a = required(live[i]),
          b = required(live[j]),
          da = required(proposals[i]),
          db = required(proposals[j]);
        if (
          (a.x + required(da[0]) - b.x - required(db[0])) ** 2 +
            (a.y + required(da[1]) - b.y - required(db[1])) ** 2 <
          (2 * RADIUS) ** 2
        ) {
          roots[root(j)] = root(i);
          merged = true;
        }
      }
    if (!merged) break;
  }
  for (const group of new Set(live.map((_, i) => root(i)))) {
    const members = live.map((_, i) => i).filter((i) => root(i) === group),
      drivers = members.filter((i) => required(live[i]).move !== 0);
    if (drivers.length === 0) continue;
    const dx = Math.round(
        drivers.reduce((a, i) => a + required(desired[i])[0], 0) /
          drivers.length,
      ),
      dy = Math.round(
        drivers.reduce((a, i) => a + required(desired[i])[1], 0) /
          drivers.length,
      );
    if (
      members.every((i) =>
        clear(
          required(live[i]).x + dx,
          required(live[i]).y + dy,
          RADIUS,
          s.arena.walls,
        ),
      )
    ) {
      for (const i of members) {
        required(live[i]).x += dx;
        required(live[i]).y += dy;
      }
    }
  }
}
function fire(s: State, t: Tank): void {
  const kind = t.weapon;
  if (
    kind === "normal" &&
    s.bullets.filter((b) => b.owner === t.slotId && b.kind === "normal")
      .length >= 5
  )
    return;
  const n = kind === "shotgun" ? 20 : 1;
  for (let i = 0; i < n; i++) {
    const angle =
      t.angle + (kind === "shotgun" ? Math.round(-45 + (i * 90) / 19) : 0);
    const speed =
      kind === "laser"
        ? 20000
        : kind === "missile"
          ? 2000
          : kind === "shotgun"
            ? 3000
            : 2500;
    const [vx, vy] = vector(angle, speed),
      [ox, oy] = vector(t.angle, 29000);
    // Spawn at the muzzle, but never on the far side of a wall.
    const obstruction = s.arena.walls
      .map((w) =>
        sweepWall(
          t.x,
          t.y,
          ox,
          oy,
          kind === "shotgun" || kind === "laser" ? 2000 : 3000,
          w,
        ),
      )
      .filter((h) => h !== null)
      .sort((a, b) => a.t - b.t)[0];
    const f =
      obstruction === undefined ? 1 : Math.max(0, obstruction.t - 0.001);
    const bullet: Bullet = {
      id: s.nextId++,
      owner: t.slotId,
      kind,
      x: t.x + Math.round(ox * f),
      y: t.y + Math.round(oy * f),
      vx,
      vy,
      age: 0,
      life: kind === "laser" ? 60 : kind === "shotgun" ? 180 : 780,
      radius: kind === "shotgun" || kind === "laser" ? 2000 : 3000,
      target: null,
      trail:
        kind === "laser"
          ? [{ x: t.x + Math.round(ox * f), y: t.y + Math.round(oy * f) }]
          : [],
    };
    if (obstruction !== undefined) {
      if (obstruction.nx !== 0) bullet.vx = -bullet.vx;
      if (obstruction.ny !== 0) bullet.vy = -bullet.vy;
    }
    s.bullets.push(bullet);
  }
  emit(s, "fire", t.x, t.y);
  if (kind !== "normal") {
    t.ammo--;
    if (t.ammo <= 0) {
      t.weapon = "normal";
      t.ammo = 0;
    }
  }
}
type MissileNavigator = ReturnType<typeof createMissileNavigator>;
function seek(s: State, b: Bullet, navigate: MissileNavigator): void {
  if (b.kind !== "missile" || b.age < 180) return;
  const target = s.tanks
    .filter((t) => t.alive)
    .sort(
      (a, c) =>
        distance(b, a) - distance(b, c) ||
        (a.slotId < c.slotId ? -1 : a.slotId > c.slotId ? 1 : 0),
    )[0];
  b.target = target?.slotId ?? null;
  if (target === undefined) return;
  const aim = navigate(b, target);
  if (aim === null) return;
  let current = 0,
    best = -Infinity;
  for (let i = 0; i < 720; i++) {
    const d = unit(i),
      dot = d[0] * b.vx + d[1] * b.vy;
    if (dot > best) {
      best = dot;
      current = i;
    }
  }
  let next = current,
    bestAim = -Infinity;
  for (let delta = -3; delta <= 3; delta++) {
    const angle = (current + delta + 720) % 720,
      d = unit(angle),
      dot = d[0] * (aim.x - b.x) + d[1] * (aim.y - b.y);
    if (dot > bestAim) {
      bestAim = dot;
      next = angle;
    }
  }
  [b.vx, b.vy] = vector(next, 2000);
}
function advanceBullet(
  s: State,
  b: Bullet,
  live: Tank[],
  hits: Set<string>,
  navigate: MissileNavigator,
): boolean {
  seek(s, b, navigate);
  let remaining = 1;
  for (let iteration = 0; iteration < 8 && remaining > 0.00001; iteration++) {
    const dx = b.vx * remaining,
      dy = b.vy * remaining;
    let nearest = 1.000001,
      nx = 0,
      ny = 0,
      hit: Tank | null = null,
      shield: Tank | null = null;
    for (const w of s.arena.walls) {
      const h = sweepWall(b.x, b.y, dx, dy, b.radius, w);
      if (h !== null && h.t < nearest) {
        nearest = h.t;
        nx = h.nx;
        ny = h.ny;
        hit = null;
        shield = null;
      }
    }
    for (const t of live) {
      const outside = distance(b, t) > (30000 + b.radius) ** 2;
      if (t.shield > 0 && outside) {
        const h = sweepCircle(b.x, b.y, dx, dy, t.x, t.y, 30000 + b.radius);
        if (h !== null && h < nearest) {
          nearest = h;
          shield = t;
          hit = null;
        }
      }
      const h = sweepCircle(b.x, b.y, dx, dy, t.x, t.y, RADIUS + b.radius);
      if (h !== null && h < nearest) {
        nearest = h;
        hit = t;
        shield = null;
      }
    }
    if (nearest > 1) {
      b.x += Math.round(dx);
      b.y += Math.round(dy);
      break;
    }
    b.x += Math.round(dx * nearest);
    b.y += Math.round(dy * nearest);
    if (b.kind === "laser") b.trail.push({ x: b.x, y: b.y });
    if (hit !== null) {
      hits.add(hit.slotId);
      return false;
    }
    if (shield !== null) {
      const sx = b.x - shield.x,
        sy = b.y - shield.y,
        norm = sx * sx + sy * sy;
      const dot = b.vx * sx + b.vy * sy;
      b.vx = Math.round(b.vx - (2 * dot * sx) / norm);
      b.vy = Math.round(b.vy - (2 * dot * sy) / norm);
      b.x += Math.sign(sx) * 4;
      b.y += Math.sign(sy) * 4;
    } else {
      if (nx !== 0) b.vx = -b.vx;
      if (ny !== 0) b.vy = -b.vy;
      b.x += nx * 4;
      b.y += ny * 4;
    }
    emit(s, "bounce", b.x, b.y);
    remaining *= 1 - nearest;
  }
  if (b.kind === "laser") {
    b.trail.push({ x: b.x, y: b.y });
    let length = 0;
    const trimmed = [{ x: b.x, y: b.y }];
    for (let i = b.trail.length - 2; i >= 0; i--) {
      const point = required(b.trail[i]),
        last = required(trimmed.at(-1));
      const segment = Math.sqrt(distance(point, last));
      if (length + segment > 50000) {
        const fraction = (50000 - length) / segment;
        trimmed.push({
          x: Math.round(last.x + (point.x - last.x) * fraction),
          y: Math.round(last.y + (point.y - last.y) * fraction),
        });
        break;
      }
      length += segment;
      trimmed.push({ ...point });
    }
    b.trail = trimmed.reverse().slice(-64);
  }
  b.age++;
  return b.age < b.life;
}
function spawnPickup(s: State, source: RealtimeRngState): RealtimeRngState {
  let rng = source;
  const random = (n: number) => {
    const r = nextRealtimeInt(rng, n);
    rng = r.next;
    return r.value;
  };
  s.nextPickup = 300 + random(181);
  if (s.pickups.length >= 3) return rng;
  const available = s.arena.cells
    .map((c) => ({
      x: ((c % s.arena.cols) + 0.5) * 100000,
      y: (Math.floor(c / s.arena.cols) + 0.5) * 100000,
    }))
    .filter(
      (p) =>
        s.tanks.every((t) => !t.alive || distance(t, p) > 50000 ** 2) &&
        s.pickups.every((q) => distance(q, p) > 40000 ** 2),
    );
  if (available.length === 0) return rng;
  const p = required(available[random(available.length)]),
    kind = required(
      (["laser", "missile", "machine", "shield", "shotgun"] as const)[
        random(5)
      ],
    );
  s.pickups.push({ id: s.nextId++, kind, ...p, life: 1200 });
  return rng;
}
function equip(t: Tank, kind: PickupKind) {
  if (kind === "shield") t.shield = 600;
  else {
    t.weapon = kind;
    t.ammo = kind === "machine" ? 10 : 1;
  }
}
function aims(state: Readonly<State>) {
  return state.tanks
    .filter((t) => t.alive && t.weapon === "laser")
    .map((t) => {
      const [ox, oy] = vector(t.angle, 29000);
      const obstruction = state.arena.walls
        .map((w) => sweepWall(t.x, t.y, ox, oy, 2000, w))
        .filter((h) => h !== null)
        .sort((a, b) => a.t - b.t)[0];
      const fraction =
        obstruction === undefined ? 1 : Math.max(0, obstruction.t - 0.001);
      let x = t.x + Math.round(ox * fraction),
        y = t.y + Math.round(oy * fraction);
      const speed = vector(t.angle, 20000);
      let dx = speed[0] * 60,
        dy = speed[1] * 60;
      if (obstruction?.nx) dx = -dx;
      if (obstruction?.ny) dy = -dy;
      const points = [{ x, y }];
      for (let i = 0; i < 40; i++) {
        const hit = state.arena.walls
          .map((w) => sweepWall(x, y, dx, dy, 2000, w))
          .filter((h) => h !== null)
          .sort((a, b) => a.t - b.t)[0];
        if (hit === undefined) {
          points.push({ x: x + dx, y: y + dy });
          break;
        }
        x += Math.round(dx * hit.t);
        y += Math.round(dy * hit.t);
        points.push({ x, y });
        dx = Math.round(dx * (1 - hit.t) * (hit.nx === 0 ? 1 : -1));
        dy = Math.round(dy * (1 - hit.t) * (hit.ny === 0 ? 1 : -1));
        x += hit.nx * 4;
        y += hit.ny * 4;
      }
      return { slotId: t.slotId, points };
    });
}
export const tankMazeDefinitionV1_1_0 = {
  manifest: tankMazeManifestV1_1_0,
  configSchema,
  inputSchema,
  createInitialState({ config, players, rng }) {
    config = configSchema.parse(config);
    if (
      players.length !== config.playerCount ||
      new Set(players).size !== players.length
    )
      throw new Error("Invalid tank participants.");
    const tanks: Tank[] = players.map((slotId, i) => ({
      slotId,
      color: config.colors[i] ?? i,
      x: 0,
      y: 0,
      angle: 0,
      alive: true,
      resigned: false,
      score: 0,
      weapon: "normal",
      ammo: 0,
      shield: 0,
      move: 0,
      turn: 0,
      lease: 0,
    }));
    const state: State = {
      tick: 0,
      config: { ...config, colors: [...config.colors] },
      arena: { width: 0, height: 0, cols: 0, rows: 0, walls: [], cells: [] },
      tanks,
      bullets: [],
      pickups: [],
      phase: "PREPARE",
      phaseTicks: 180,
      elapsed: 0,
      bout: 0,
      nextPickup: 300,
      nextId: 1,
      outcome: null,
      events: [],
    };
    return { state, rng: resetBout(state, rng) };
  },
  step(context) {
    if (context.tick !== context.state.tick)
      throw new Error("Nonconsecutive tank tick.");
    const s: State = JSON.parse(JSON.stringify(context.state));
    let rng = { ...context.rng };
    s.tick = context.tick + 1;
    s.events = [];
    if (s.outcome !== null) return { state: s, rng };
    const shots: Tank[] = [];
    for (const entry of context.inputs) {
      const t = s.tanks.find((t) => t.slotId === entry.slotId);
      if (t === undefined || t.resigned) continue;
      const input = inputSchema.parse(entry.input);
      if (input.type === "RESIGN") {
        t.resigned = true;
        t.alive = false;
        t.move = 0;
        t.turn = 0;
        continue;
      }
      if (!t.alive || s.phase === "PREPARE") continue;
      if (input.type === "MOVE") {
        t.move = input.move;
        t.turn = input.turn;
        t.lease = 30;
      } else shots.push(t);
    }
    const remaining = s.tanks.filter((t) => !t.resigned);
    if (remaining.length <= 1) {
      result(s, remaining[0]?.slotId ?? null, "RESIGNATION");
      return { state: s, rng };
    }
    if (s.phase === "PREPARE") {
      s.phaseTicks--;
      if (s.phaseTicks === 0) s.phase = "ACTIVE";
      return { state: s, rng };
    }
    s.elapsed++;
    for (const t of s.tanks) if (t.shield > 0) t.shield--;
    moveTanks(s);
    for (const t of shots) if (t.alive) fire(s, t);
    const live = s.tanks.filter((t) => t.alive),
      hits = new Set<string>();
    const navigate = createMissileNavigator(s.arena);
    s.bullets = s.bullets.filter((b) =>
      advanceBullet(s, b, live, hits, navigate),
    );
    for (const t of live)
      if (hits.has(t.slotId)) {
        t.alive = false;
        t.move = 0;
        t.turn = 0;
        emit(s, "hit", t.x, t.y);
      }
    s.pickups = s.pickups.filter((p) => {
      p.life--;
      if (p.life <= 0) return false;
      const tank = s.tanks
        .filter((t) => t.alive && distance(t, p) < (RADIUS + 10000) ** 2)
        .sort(
          (a, b) =>
            distance(a, p) - distance(b, p) ||
            (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0),
        )[0];
      if (tank !== undefined) {
        equip(tank, p.kind);
        emit(s, "pickup", p.x, p.y);
        return false;
      }
      return true;
    });
    const survivors = s.tanks.filter((t) => t.alive);
    if (s.phase === "ACTIVE" && survivors.length === 1) {
      s.phase = "LAST";
      s.phaseTicks = 240;
    } else if (s.phase === "LAST") s.phaseTicks--;
    const settle =
      survivors.length === 0 ||
      (s.phase === "LAST" && s.phaseTicks === 0) ||
      (s.phase === "ACTIVE" && s.elapsed >= 7200);
    if (settle) {
      const winner = survivors.length === 1 ? survivors[0] : undefined;
      if (winner !== undefined) winner.score++;
      if (winner !== undefined && winner.score >= s.config.targetScore)
        result(s, winner.slotId, "SCORE");
      else rng = resetBout(s, rng);
    } else if (s.phase === "ACTIVE") {
      s.nextPickup--;
      if (s.nextPickup <= 0) rng = spawnPickup(s, rng);
    }
    return { state: s, rng };
  },
  projectView({ state, viewer }) {
    // Explicit projection excludes held input, lease, RNG and generation bookkeeping.
    return {
      tick: state.tick,
      selfSlotId: viewer.slotId,
      config: {
        playerCount: state.config.playerCount,
        targetScore: state.config.targetScore,
      },
      arena: {
        width: state.arena.width,
        height: state.arena.height,
        walls: state.arena.walls.map((w) => ({ ...w })),
      },
      tanks: state.tanks.map((t) => ({
        slotId: t.slotId,
        color: t.color,
        x: t.x,
        y: t.y,
        angle: t.angle,
        alive: t.alive,
        resigned: t.resigned,
        score: t.score,
        weapon: t.weapon,
        ammo: t.ammo,
        shield: t.shield,
        normalCount: state.bullets.filter(
          (b) => b.owner === t.slotId && b.kind === "normal",
        ).length,
      })),
      aims: aims(state),
      bullets: state.bullets.map((b) => ({
        ...b,
        trail: b.trail.map((p) => ({ ...p })),
      })),
      pickups: state.pickups.map((p) => ({ ...p })),
      phase: state.phase,
      phaseTicks: state.phaseTicks,
      elapsed: state.elapsed,
      bout: state.bout,
      outcome:
        state.outcome === null
          ? null
          : (JSON.parse(JSON.stringify(state.outcome)) as Outcome),
      events: state.events.map((e) => ({ ...e })),
    };
  },
  getOutcome(state) {
    return state.outcome;
  },
} satisfies RealtimeGameDefinition<Config, State, Input, View, Outcome>;
type View = {
  tick: number;
  selfSlotId: string;
  config: Pick<Config, "playerCount" | "targetScore">;
  arena: Pick<State["arena"], "width" | "height" | "walls">;
  tanks: (Omit<Tank, "move" | "turn" | "lease"> & { normalCount: number })[];
  aims: ReturnType<typeof aims>;
  bullets: Bullet[];
  pickups: State["pickups"];
  phase: State["phase"];
  phaseTicks: number;
  elapsed: number;
  bout: number;
  outcome: Outcome | null;
  events: State["events"];
};

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required tank value is missing.");
  return value;
}
