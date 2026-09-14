import {
  nextRealtimeInt,
  type RealtimeGameDefinition,
  type RealtimeRngState,
} from "@online-game-hub/realtime-game-sdk";
import {
  configSchema,
  inputSchema,
  type Config,
  type Input,
  type Outcome,
} from "../contracts.js";
import {
  CELL_SIZE,
  classicMap,
  classicMode,
  spawnCells,
  type ModeDefinition,
} from "../definitions.js";
import { bombermanManifest } from "../manifest.js";
import { generateArena } from "./map.js";
import { resolveExplosions } from "./explosions.js";
import {
  cellCenter,
  movePlayer,
  overlapsCell,
  pathTouchesCell,
  playerCell,
} from "./movement.js";
import type { Player, State } from "./model.js";

function resetPlayers(players: readonly Player[], rotation: number): Player[] {
  const cells = spawnCells(classicMap, players.length, rotation);
  return players.map((player, index) => ({
    ...player,
    ...cellCenter(required(cells[index]), classicMap.cols),
    alive: !player.resigned,
    capacity: classicMode.initialCapacity,
    range: classicMode.initialRange,
    speed: classicMode.initialSpeed,
    direction: "none",
    facing: "down",
    lease: 0,
    walking: false,
  }));
}

function copyState(state: Readonly<State>): State {
  return {
    ...state,
    config: { ...state.config },
    arena: {
      ...state.arena,
      tiles: [...state.arena.tiles],
      concealed: state.arena.concealed.map((loot) => ({ ...loot })),
    },
    players: state.players.map((player) => ({ ...player })),
    bombs: state.bombs.map((bomb) => ({
      ...bomb,
      passThrough: [...bomb.passThrough],
    })),
    flames: state.flames.map((flame) => ({ ...flame })),
    pickups: state.pickups.map((loot) => ({ ...loot })),
    pendingLoot: state.pendingLoot.map((loot) => ({ ...loot })),
    events: state.events.map((event) => ({ ...event })),
    roundResult: state.roundResult ? { ...state.roundResult } : null,
    outcome: state.outcome
      ? {
          ...state.outcome,
          scores: state.outcome.scores.map((score) => ({ ...score })),
        }
      : null,
  };
}
function clearControls(state: State): void {
  for (const player of state.players) {
    player.direction = "none";
    player.lease = 0;
    player.walking = false;
  }
}
function complete(
  state: State,
  winnerSlotId: string | null,
  reason: Outcome["reason"],
): void {
  state.phase = "COMPLETE";
  state.phaseTicks = 0;
  state.outcome = {
    type: winnerSlotId === null ? "DRAW" : "WIN",
    winnerSlotId,
    reason,
    scores: state.players.map(({ slotId, score }) => ({ slotId, score })),
  };
  clearControls(state);
}
function effect(
  state: State,
  kind: State["events"][number]["kind"],
  x: number,
  y: number,
): void {
  state.events.push({ id: state.nextId++, kind, x, y, tick: state.tick });
}
function finishBout(state: State, mode: ModeDefinition): void {
  const alive = state.players.filter(
    (player) => player.alive && !player.resigned,
  );
  if (alive.length > 1 && state.elapsed < mode.roundTicks) return;
  const winner = alive.length === 1 ? required(alive[0]) : null;
  state.roundResult = {
    winnerSlotId: winner?.slotId ?? null,
    reason: winner
      ? "SURVIVOR"
      : alive.length === 0
        ? "ALL_ELIMINATED"
        : "TIMEOUT",
  };
  if (winner) winner.score += 1;
  if (winner && winner.score >= mode.targetWins)
    complete(state, winner.slotId, "SCORE");
  else {
    state.phase = "RESULT";
    state.phaseTicks = mode.resultTicks;
    clearControls(state);
  }
}
function collectPickups(state: State, mode: ModeDefinition): void {
  state.pickups = state.pickups.filter((pickup) => {
    const center = cellCenter(pickup.cell, state.arena.cols);
    const distance = (player: Player) =>
      (player.x - center.x) ** 2 + (player.y - center.y) ** 2;
    const player = state.players
      .filter(
        (entry) =>
          entry.alive &&
          !entry.resigned &&
          playerCell(entry, state.arena.cols) === pickup.cell,
      )
      .sort((a, b) => distance(a) - distance(b) || a.index - b.index)[0];
    if (!player) return true;
    if (pickup.kind === "capacity")
      player.capacity = Math.min(mode.maxCapacity, player.capacity + 1);
    if (pickup.kind === "range")
      player.range = Math.min(mode.maxRange, player.range + 1);
    if (pickup.kind === "speed")
      player.speed = Math.min(
        mode.maxSpeed,
        player.speed + mode.speedIncrement,
      );
    effect(state, "pickup", center.x, center.y);
    return false;
  });
}

function projectView({
  state,
  viewer,
}: {
  state: Readonly<State>;
  viewer: { kind: "player"; slotId: string };
}) {
  return {
    selfSlotId: viewer.slotId,
    config: { ...state.config },
    arena: {
      cols: state.arena.cols,
      rows: state.arena.rows,
      cellSize: CELL_SIZE,
      tiles: [...state.arena.tiles],
    },
    phase: state.phase,
    phaseTicks: state.phaseTicks,
    bout: state.bout,
    remainingTicks: Math.max(0, classicMode.roundTicks - state.elapsed),
    targetWins: classicMode.targetWins,
    players: state.players.map((player) => ({
      slotId: player.slotId,
      index: player.index,
      x: player.x,
      y: player.y,
      alive: player.alive,
      resigned: player.resigned,
      score: player.score,
      capacity: player.capacity,
      activeBombs: state.bombs.filter(
        (bomb) => bomb.ownerSlotId === player.slotId,
      ).length,
      range: player.range,
      speed: (player.speed * 60) / CELL_SIZE,
      facing: player.facing,
      walking: player.walking,
    })),
    bombs: state.bombs.map((bomb) => ({
      id: bomb.id,
      cell: bomb.cell,
      ownerSlotId: bomb.ownerSlotId,
      fuseTicks: Math.max(0, bomb.explodeAt - state.elapsed),
    })),
    flames: state.flames.map((flame) => ({
      cell: flame.cell,
      remainingTicks: Math.max(0, flame.expiresAt - state.elapsed),
    })),
    pickups: state.pickups.map((pickup) => ({ ...pickup })),
    events: state.events.map(({ id, kind, x, y }) => ({ id, kind, x, y })),
    roundResult: state.roundResult ? { ...state.roundResult } : null,
    outcome: state.outcome
      ? {
          ...state.outcome,
          scores: state.outcome.scores.map((score) => ({ ...score })),
        }
      : null,
  };
}
type View = ReturnType<typeof projectView>;

export const bombermanDefinition = {
  manifest: bombermanManifest,
  configSchema,
  inputSchema,
  createInitialState({ config: inputConfig, players, rng: inputRng }) {
    const config = configSchema.parse(inputConfig);
    if (
      players.length !== config.playerCount ||
      new Set(players).size !== players.length ||
      players.some((slot) => slot.length === 0)
    )
      throw new Error("Invalid Bomberman participants.");
    const rotation = nextRealtimeInt(inputRng, classicMap.spawnCycle.length);
    const generated = generateArena(classicMap, classicMode, rotation.next);
    const initialPlayers: Player[] = players.map((slotId, index) => ({
      slotId,
      index,
      x: 0,
      y: 0,
      alive: true,
      resigned: false,
      score: 0,
      capacity: 1,
      range: 2,
      speed: 60,
      direction: "none",
      facing: "down",
      lease: 0,
      walking: false,
    }));
    const state: State = {
      tick: 0,
      config,
      arena: generated.arena,
      players: resetPlayers(initialPlayers, rotation.value),
      bombs: [],
      flames: [],
      pickups: [],
      pendingLoot: [],
      phase: "PREPARE",
      phaseTicks: classicMode.prepareTicks,
      elapsed: 0,
      bout: 1,
      spawnRotation: rotation.value,
      nextId: 1,
      events: [],
      roundResult: null,
      outcome: null,
    };
    return { state, rng: generated.rng };
  },
  step({ state: previous, tick, inputs, rng: previousRng }) {
    const state = copyState(previous);
    let rng: RealtimeRngState = { ...previousRng };
    if (state.outcome) return { state, rng };
    state.tick = tick + 1;
    state.events = state.events.filter((event) => state.tick - event.tick < 60);
    let resigned = false;
    for (const { slotId, input } of inputs) {
      const player = state.players.find((entry) => entry.slotId === slotId);
      if (input.type === "RESIGN" && player && !player.resigned) {
        player.resigned = true;
        player.alive = false;
        player.walking = false;
        player.direction = "none";
        player.lease = 0;
        resigned = true;
      }
    }
    if (resigned) {
      const eligible = state.players.filter((player) => !player.resigned);
      if (eligible.length <= 1) {
        complete(state, eligible[0]?.slotId ?? null, "RESIGNATION");
        return { state, rng };
      }
    }
    if (state.phase === "PREPARE") {
      state.phaseTicks -= 1;
      if (state.phaseTicks === 0) state.phase = "ACTIVE";
      return { state, rng };
    }
    if (state.phase === "RESULT") {
      state.phaseTicks -= 1;
      if (state.phaseTicks === 0) {
        state.bout += 1;
        state.spawnRotation =
          (state.spawnRotation + 1) % classicMap.spawnCycle.length;
        const generated = generateArena(classicMap, classicMode, rng);
        rng = generated.rng;
        state.arena = generated.arena;
        state.players = resetPlayers(state.players, state.spawnRotation);
        state.bombs = [];
        state.flames = [];
        state.pickups = [];
        state.pendingLoot = [];
        state.events = [];
        state.elapsed = 0;
        state.roundResult = null;
        state.phase = "PREPARE";
        state.phaseTicks = classicMode.prepareTicks;
      }
      return { state, rng };
    }
    state.flames = state.flames.filter(
      (flame) => flame.expiresAt > state.elapsed,
    );
    const burningCells = new Set(state.flames.map((flame) => flame.cell));
    state.pickups.push(
      ...state.pendingLoot.filter((loot) => !burningCells.has(loot.cell)),
    );
    state.pendingLoot = state.pendingLoot.filter((loot) =>
      burningCells.has(loot.cell),
    );
    for (const { slotId, input } of inputs) {
      const player = state.players.find((entry) => entry.slotId === slotId);
      if (player && player.alive && !player.resigned && input.type === "MOVE") {
        player.direction = input.direction;
        player.lease = input.direction === "none" ? 0 : classicMode.leaseTicks;
        if (input.direction !== "none") player.facing = input.direction;
      }
    }
    const crossedFlames = new Set<string>();
    for (const player of state.players) {
      if (player.lease <= 0) player.direction = "none";
      const path = movePlayer(player, state.arena, state.bombs);
      if (
        path.some((segment) =>
          state.flames.some((flame) =>
            pathTouchesCell(segment, flame.cell, state.arena.cols),
          ),
        )
      )
        crossedFlames.add(player.slotId);
      player.lease = Math.max(0, player.lease - 1);
    }
    for (const bomb of state.bombs)
      bomb.passThrough = bomb.passThrough.filter((slotId) =>
        state.players.some(
          (player) =>
            player.slotId === slotId &&
            player.alive &&
            overlapsCell(player.x, player.y, bomb.cell, state.arena.cols),
        ),
      );
    for (const { slotId, input } of inputs) {
      if (input.type !== "PLACE_BOMB") continue;
      const player = state.players.find((entry) => entry.slotId === slotId);
      if (!player || !player.alive || player.resigned) continue;
      const cell = playerCell(player, state.arena.cols);
      if (
        state.arena.tiles[cell] !== "floor" ||
        state.bombs.some((bomb) => bomb.cell === cell) ||
        state.bombs.filter((bomb) => bomb.ownerSlotId === slotId).length >=
          player.capacity
      )
        continue;
      state.bombs.push({
        id: state.nextId++,
        cell,
        ownerSlotId: slotId,
        range: player.range,
        explodeAt: state.elapsed + classicMode.fuseTicks,
        passThrough: state.players
          .filter(
            (entry) =>
              entry.alive &&
              overlapsCell(entry.x, entry.y, cell, state.arena.cols),
          )
          .map((entry) => entry.slotId),
      });
      const center = cellCenter(cell, state.arena.cols);
      effect(state, "place", center.x, center.y);
    }
    for (const cell of resolveExplosions(state, classicMode)) {
      const center = cellCenter(cell, state.arena.cols);
      effect(state, "explode", center.x, center.y);
    }
    for (const player of state.players) {
      if (
        player.alive &&
        (crossedFlames.has(player.slotId) ||
          state.flames.some((flame) =>
            overlapsCell(player.x, player.y, flame.cell, state.arena.cols),
          ))
      ) {
        player.alive = false;
        player.walking = false;
        player.direction = "none";
        player.lease = 0;
        effect(state, "eliminate", player.x, player.y);
      }
    }
    collectPickups(state, classicMode);
    state.elapsed += 1;
    finishBout(state, classicMode);
    state.events = state.events.slice(-128);
    return { state, rng };
  },
  projectView,
  getOutcome(state) {
    return state.outcome;
  },
} satisfies RealtimeGameDefinition<Config, State, Input, View, Outcome>;

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing Bomberman value.");
  return value;
}
