import type { RealtimeGameDefinition } from "@online-game-hub/realtime-game-sdk";

// Frozen 1.0.0 rules: retain the original speed limit and compressed contacts.
import { COURT, PHYSICS } from "./constants.js";
import { airHockeyManifest } from "./manifest.js";
import { clampPaddle, simulate } from "./physics.js";
import {
  airHockeyConfigSchema,
  airHockeyInputSchema,
  type AirHockeyConfig,
  type AirHockeyInput,
  type AirHockeyOutcome,
  type AirHockeyState,
  type Side,
} from "./schemas.js";

export { COURT, PHYSICS } from "./constants.js";
export {
  airHockeyConfigSchema,
  airHockeyInputSchema,
  airHockeyStateSchema,
  airHockeyOutcomeSchema,
} from "./schemas.js";
export type {
  AirHockeyConfig,
  AirHockeyInput,
  AirHockeyState,
  AirHockeyOutcome,
  Side,
} from "./schemas.js";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function freshPaddle(side: Side): AirHockeyState["paddles"][number] {
  return {
    x: COURT.width / 2,
    y: (COURT.height * (side === 0 ? 3 : 1)) / 4,
    target: null,
    inputAge: PHYSICS.inputLease,
  };
}

function resetForServe(state: AirHockeyState): void {
  state.phase = "SERVE";
  state.paddles = [freshPaddle(0), freshPaddle(1)];
  state.puck = {
    x: COURT.width / 2,
    y: COURT.height / 2,
    velocityX: 0,
    velocityY: 0,
  };
}

function projectView(state: Readonly<AirHockeyState>, slotId: string) {
  const yourSide = state.players.indexOf(slotId);
  if (yourSide !== 0 && yourSide !== 1)
    throw new Error("Viewer must be a participant.");
  return freeze({
    field: { ...COURT },
    players: state.players.map((player, side) => ({
      slotId: player,
      side,
      color: side === 0 ? "BLUE" : "ORANGE",
    })),
    yourSide,
    paddles: state.paddles.map(({ x, y }) => ({ x, y })),
    puck: { x: state.puck.x, y: state.puck.y },
    scores: [...state.scores],
    targetScore: state.targetScore,
    phase: state.phase,
    server: state.server,
    tick: state.tick,
    rally: state.rally,
    events: state.events.map((event) => ({ ...event })),
    outcome:
      state.outcome === null
        ? null
        : { ...state.outcome, scores: [...state.outcome.scores] },
  });
}

export type AirHockeyView = ReturnType<typeof projectView>;

export const airHockeyDefinition = Object.freeze({
  manifest: airHockeyManifest,
  configSchema: airHockeyConfigSchema,
  inputSchema: airHockeyInputSchema,
  createInitialState({ config, players, rng }) {
    const canonical = airHockeyConfigSchema.parse(config);
    const [p1, p2] = players;
    if (
      players.length !== 2 ||
      p1 === undefined ||
      p2 === undefined ||
      p1 === p2
    )
      throw new Error("Air hockey requires two distinct player slots.");
    const state: AirHockeyState = {
      players: [p1, p2],
      targetScore: canonical.targetScore,
      tick: 0,
      phase: "SERVE",
      server: 0,
      rally: 1,
      paddles: [freshPaddle(0), freshPaddle(1)],
      puck: {
        x: COURT.width / 2,
        y: COURT.height / 2,
        velocityX: 0,
        velocityY: 0,
      },
      scores: [0, 0],
      eventSequence: 0,
      events: [],
      outcome: null,
    };
    return { state: freeze(state), rng: { ...rng } };
  },
  step({ state: previous, tick, inputs, rng }) {
    if (previous.outcome !== null)
      throw new Error("Cannot step a finished game.");
    if (tick !== previous.tick)
      throw new Error("Simulation ticks must be consecutive.");
    const canonical = inputs.map(({ slotId, input }) => {
      const side = previous.players.indexOf(slotId);
      if (side !== 0 && side !== 1)
        throw new Error("Input actor must be a participant.");
      return { side, input: airHockeyInputSchema.parse(input) } as const;
    });
    const state: AirHockeyState = {
      ...previous,
      players: [...previous.players],
      scores: [...previous.scores],
      paddles: previous.paddles.map((paddle) => ({
        ...paddle,
        target: paddle.target === null ? null : { ...paddle.target },
      })) as AirHockeyState["paddles"],
      puck: { ...previous.puck },
      events: previous.events
        .filter((event) => tick - event.tick < PHYSICS.eventLifetime)
        .map((event) => ({ ...event })),
      tick: tick + 1,
    };
    for (const side of [0, 1] as const) {
      if (
        canonical.some(
          (entry) => entry.side === side && entry.input.type === "RESIGN",
        )
      ) {
        state.phase = "FINISHED";
        state.outcome = {
          type: "WIN",
          reason: "RESIGNATION",
          winnerSlotId: state.players[side === 0 ? 1 : 0],
          resignedSlotId: state.players[side],
          scores: [...state.scores],
        };
        return { state: freeze(state), rng: { ...rng } };
      }
    }
    for (const { side, input } of canonical) {
      if (input.type !== "CONTROL") continue;
      const paddle = state.paddles[side];
      paddle.inputAge = 0;
      paddle.target =
        input.target === null
          ? null
          : clampPaddle(
              {
                x: Math.trunc(
                  (input.target.x * COURT.width) / PHYSICS.pointerScale,
                ),
                y:
                  side === 0
                    ? Math.trunc(
                        (input.target.y * COURT.height) / PHYSICS.pointerScale,
                      )
                    : COURT.height -
                      Math.trunc(
                        (input.target.y * COURT.height) / PHYSICS.pointerScale,
                      ),
              },
              side,
            );
    }
    for (const paddle of state.paddles) {
      paddle.inputAge = Math.min(PHYSICS.inputLease, paddle.inputAge + 1);
      if (paddle.inputAge >= PHYSICS.inputLease) paddle.target = null;
    }
    const conceded = simulate(state, tick);
    if (conceded !== null) {
      const winner = conceded === 0 ? 1 : 0;
      state.scores[winner] += 1;
      if (state.scores[winner] >= state.targetScore) {
        state.phase = "FINISHED";
        state.outcome = {
          type: "WIN",
          reason: "SCORE",
          winnerSlotId: state.players[winner],
          scores: [...state.scores],
        };
      } else {
        state.server = conceded;
        state.rally += 1;
        resetForServe(state);
      }
    }
    return { state: freeze(state), rng: { ...rng } };
  },
  projectView: ({ state, viewer }) => projectView(state, viewer.slotId),
  getOutcome: (state) => state.outcome,
} satisfies RealtimeGameDefinition<
  AirHockeyConfig,
  AirHockeyState,
  AirHockeyInput,
  AirHockeyView,
  AirHockeyOutcome
>);
