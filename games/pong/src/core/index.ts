import { nextRealtimeInt } from "@online-game-hub/realtime-game-sdk";
import type {
  RealtimeGameDefinition,
  RealtimePlayerInput,
  RealtimePlayerSlotId,
  RealtimeRngState,
} from "@online-game-hub/realtime-game-sdk";
import { z } from "zod";

import {
  PONG_BALL_RADIUS,
  PONG_BALL_SPEED_X,
  PONG_BALL_SPEED_Y,
  PONG_FIELD_HEIGHT,
  PONG_FIELD_WIDTH,
  PONG_LEFT_PADDLE_X,
  PONG_PADDLE_HEIGHT,
  PONG_PADDLE_SPEED,
  PONG_PADDLE_WIDTH,
  PONG_RIGHT_PADDLE_X,
} from "../constants.js";
import { pongManifest } from "../manifest.js";
import type {
  PongConfig,
  PongDirection,
  PongInput,
  PongOutcome,
  PongState,
  PongView,
} from "../types.js";

export type {
  PongConfig,
  PongDirection,
  PongInput,
  PongOutcome,
  PongState,
  PongView,
} from "../types.js";
export {
  PONG_BALL_RADIUS,
  PONG_BALL_SPEED_X,
  PONG_BALL_SPEED_Y,
  PONG_FIELD_HEIGHT,
  PONG_FIELD_WIDTH,
  PONG_LEFT_PADDLE_X,
  PONG_PADDLE_HEIGHT,
  PONG_PADDLE_SPEED,
  PONG_PADDLE_WIDTH,
  PONG_RIGHT_PADDLE_X,
  PONG_TICK_RATE,
} from "../constants.js";

const slotSchema = z.string().min(1);
const directionSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
const scoreSchema = z.number().int().min(0).max(9);

export const pongConfigSchema = z
  .object({ targetScore: z.number().int().min(1).max(9) })
  .strict();

export const pongInputSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("DIRECTION"), direction: directionSchema })
    .strict(),
  z.object({ type: z.literal("RESIGN") }).strict(),
]);

export const pongOutcomeSchema = z.union([
  z
    .object({
      type: z.literal("WIN"),
      reason: z.literal("SCORE"),
      winnerSlotId: slotSchema,
      scores: z.tuple([scoreSchema, scoreSchema]),
    })
    .strict(),
  z
    .object({
      type: z.literal("WIN"),
      reason: z.literal("RESIGNATION"),
      winnerSlotId: slotSchema,
      resignedSlotId: slotSchema,
      scores: z.tuple([scoreSchema, scoreSchema]),
    })
    .strict(),
]);

export const pongStateSchema = z
  .object({
    players: z.tuple([slotSchema, slotSchema]),
    targetScore: z.number().int().min(1).max(9),
    tick: z.number().int().min(0),
    paddles: z.tuple([
      z.object({ y: z.number().int(), direction: directionSchema }).strict(),
      z.object({ y: z.number().int(), direction: directionSchema }).strict(),
    ]),
    ball: z
      .object({
        x: z.number().int(),
        y: z.number().int(),
        velocityX: z.number().int(),
        velocityY: z.number().int(),
      })
      .strict(),
    scores: z.tuple([scoreSchema, scoreSchema]),
    resignedSlotId: slotSchema.nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.players[0] === state.players[1]) {
      context.addIssue({
        code: "custom",
        message: "Pong player slots must be distinct.",
        path: ["players"],
      });
    }
    const minY = PONG_PADDLE_HEIGHT / 2;
    const maxY = PONG_FIELD_HEIGHT - minY;
    for (const [index, paddle] of state.paddles.entries()) {
      if (paddle.y < minY || paddle.y > maxY) {
        context.addIssue({
          code: "custom",
          message: "Paddle is outside the field.",
          path: ["paddles", index, "y"],
        });
      }
    }
    if (
      state.resignedSlotId !== null &&
      !state.players.includes(state.resignedSlotId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Resigned slot must be a player.",
        path: ["resignedSlotId"],
      });
    }
  });

export const pongViewSchema = z
  .object({
    field: z
      .object({
        width: z.literal(PONG_FIELD_WIDTH),
        height: z.literal(PONG_FIELD_HEIGHT),
      })
      .strict(),
    players: z.tuple([
      z.object({ slotId: slotSchema, side: z.literal("LEFT") }).strict(),
      z.object({ slotId: slotSchema, side: z.literal("RIGHT") }).strict(),
    ]),
    paddles: z.tuple([
      z
        .object({ y: z.number().int(), height: z.literal(PONG_PADDLE_HEIGHT) })
        .strict(),
      z
        .object({ y: z.number().int(), height: z.literal(PONG_PADDLE_HEIGHT) })
        .strict(),
    ]),
    ball: z
      .object({
        x: z.number().int(),
        y: z.number().int(),
        radius: z.literal(PONG_BALL_RADIUS),
      })
      .strict(),
    scores: z.tuple([scoreSchema, scoreSchema]),
    tick: z.number().int().min(0),
    targetScore: z.number().int().min(1).max(9),
    yourSide: z.enum(["LEFT", "RIGHT"]).nullable(),
    outcome: pongOutcomeSchema.nullable(),
  })
  .strict();

function requirePlayers(
  players: readonly RealtimePlayerSlotId[],
): readonly [RealtimePlayerSlotId, RealtimePlayerSlotId] {
  const left = players[0];
  const right = players[1];
  if (
    players.length !== 2 ||
    left === undefined ||
    right === undefined ||
    left === right
  ) {
    throw new Error("Pong requires exactly two distinct player slots.");
  }
  return Object.freeze([left, right]);
}

function freezeOutcome(outcome: PongOutcome): PongOutcome {
  return Object.freeze({
    ...outcome,
    scores: Object.freeze([...outcome.scores]) as readonly [number, number],
  });
}

function freezeState(input: unknown): PongState {
  const state = pongStateSchema.parse(input);
  return Object.freeze({
    players: Object.freeze([...state.players]) as readonly [
      RealtimePlayerSlotId,
      RealtimePlayerSlotId,
    ],
    targetScore: state.targetScore,
    tick: state.tick,
    paddles: Object.freeze(
      state.paddles.map((paddle) => Object.freeze({ ...paddle })),
    ) as PongState["paddles"],
    ball: Object.freeze({ ...state.ball }),
    scores: Object.freeze([...state.scores]) as readonly [number, number],
    resignedSlotId: state.resignedSlotId as RealtimePlayerSlotId | null,
  });
}

function serveBall(rng: Readonly<RealtimeRngState>): {
  readonly ball: PongState["ball"];
  readonly rng: RealtimeRngState;
} {
  const horizontal = nextRealtimeInt(rng, 2);
  const vertical = nextRealtimeInt(horizontal.next, 2);
  return {
    ball: Object.freeze({
      x: PONG_FIELD_WIDTH / 2,
      y: PONG_FIELD_HEIGHT / 2,
      velocityX:
        horizontal.value === 0 ? -PONG_BALL_SPEED_X : PONG_BALL_SPEED_X,
      velocityY: vertical.value === 0 ? -PONG_BALL_SPEED_Y : PONG_BALL_SPEED_Y,
    }),
    rng: vertical.next,
  };
}

export function createInitialState(context: {
  readonly config: Readonly<PongConfig>;
  readonly players: readonly RealtimePlayerSlotId[];
  readonly rng: Readonly<RealtimeRngState>;
}): { readonly state: PongState; readonly rng: RealtimeRngState } {
  const config = pongConfigSchema.parse(context.config);
  const players = requirePlayers(context.players);
  const served = serveBall(context.rng);
  return {
    state: freezeState({
      players,
      targetScore: config.targetScore,
      tick: 0,
      paddles: [
        { y: PONG_FIELD_HEIGHT / 2, direction: 0 },
        { y: PONG_FIELD_HEIGHT / 2, direction: 0 },
      ],
      ball: served.ball,
      scores: [0, 0],
      resignedSlotId: null,
    }),
    rng: served.rng,
  };
}

export function getOutcome(
  stateInput: Readonly<PongState>,
): PongOutcome | null {
  const state = freezeState(stateInput);
  if (state.resignedSlotId !== null) {
    const winner =
      state.players[0] === state.resignedSlotId
        ? state.players[1]
        : state.players[0];
    return freezeOutcome({
      type: "WIN",
      reason: "RESIGNATION",
      winnerSlotId: winner,
      resignedSlotId: state.resignedSlotId,
      scores: state.scores,
    });
  }
  const winnerIndex =
    state.scores[0] >= state.targetScore
      ? 0
      : state.scores[1] >= state.targetScore
        ? 1
        : null;
  return winnerIndex === null
    ? null
    : freezeOutcome({
        type: "WIN",
        reason: "SCORE",
        winnerSlotId: state.players[winnerIndex],
        scores: state.scores,
      });
}

function clampPaddle(y: number): number {
  const half = PONG_PADDLE_HEIGHT / 2;
  return Math.max(half, Math.min(PONG_FIELD_HEIGHT - half, y));
}

function paddleHit(ballY: number, paddleY: number): boolean {
  return (
    ballY + PONG_BALL_RADIUS >= paddleY - PONG_PADDLE_HEIGHT / 2 &&
    ballY - PONG_BALL_RADIUS <= paddleY + PONG_PADDLE_HEIGHT / 2
  );
}

function bouncedVelocityY(ballY: number, paddleY: number): number {
  const offset = ballY - paddleY;
  const scaled = Math.trunc(
    (offset * PONG_BALL_SPEED_Y * 2) / (PONG_PADDLE_HEIGHT / 2),
  );
  if (scaled === 0) return PONG_BALL_SPEED_Y;
  return Math.max(
    -PONG_BALL_SPEED_Y * 2,
    Math.min(PONG_BALL_SPEED_Y * 2, scaled),
  );
}

export function step(context: {
  readonly state: Readonly<PongState>;
  readonly tick: number;
  readonly inputs: readonly RealtimePlayerInput<PongInput>[];
  readonly rng: Readonly<RealtimeRngState>;
}): { readonly state: PongState; readonly rng: RealtimeRngState } {
  const state = freezeState(context.state);
  if (getOutcome(state) !== null)
    throw new Error("Pong match is already finished.");
  if (context.tick !== state.tick)
    throw new Error("Pong tick is not contiguous.");

  const directions: [PongDirection, PongDirection] = [
    state.paddles[0].direction,
    state.paddles[1].direction,
  ];
  let resignedSlotId: RealtimePlayerSlotId | null = null;
  let previousPlayerIndex = -1;
  const seen = new Set<RealtimePlayerSlotId>();
  for (const change of context.inputs) {
    const playerIndex = state.players.indexOf(change.slotId);
    if (playerIndex < 0) throw new Error("Pong input actor is not a player.");
    if (seen.has(change.slotId))
      throw new Error("Pong input frame contains a duplicate slot.");
    if (playerIndex < previousPlayerIndex)
      throw new Error("Pong inputs are not in stable slot order.");
    previousPlayerIndex = playerIndex;
    seen.add(change.slotId);
    const parsed = pongInputSchema.parse(change.input);
    if (parsed.type === "RESIGN") {
      resignedSlotId ??= change.slotId;
    } else {
      directions[playerIndex as 0 | 1] = parsed.direction;
    }
  }

  const paddles = Object.freeze([
    Object.freeze({
      y: clampPaddle(state.paddles[0].y + directions[0] * PONG_PADDLE_SPEED),
      direction: directions[0],
    }),
    Object.freeze({
      y: clampPaddle(state.paddles[1].y + directions[1] * PONG_PADDLE_SPEED),
      direction: directions[1],
    }),
  ]) as PongState["paddles"];
  if (resignedSlotId !== null) {
    return {
      state: freezeState({
        ...state,
        tick: state.tick + 1,
        paddles,
        resignedSlotId,
      }),
      rng: context.rng as RealtimeRngState,
    };
  }

  let nextX = state.ball.x + state.ball.velocityX;
  let nextY = state.ball.y + state.ball.velocityY;
  let velocityX = state.ball.velocityX;
  let velocityY = state.ball.velocityY;

  if (nextY - PONG_BALL_RADIUS <= 0) {
    nextY = PONG_BALL_RADIUS + (PONG_BALL_RADIUS - nextY);
    velocityY = Math.abs(velocityY);
  } else if (nextY + PONG_BALL_RADIUS >= PONG_FIELD_HEIGHT) {
    nextY =
      PONG_FIELD_HEIGHT -
      PONG_BALL_RADIUS -
      (nextY + PONG_BALL_RADIUS - PONG_FIELD_HEIGHT);
    velocityY = -Math.abs(velocityY);
  }

  const leftSurface = PONG_LEFT_PADDLE_X + PONG_PADDLE_WIDTH / 2;
  const rightSurface = PONG_RIGHT_PADDLE_X - PONG_PADDLE_WIDTH / 2;
  if (
    velocityX < 0 &&
    state.ball.x - PONG_BALL_RADIUS >= leftSurface &&
    nextX - PONG_BALL_RADIUS <= leftSurface &&
    paddleHit(nextY, paddles[0].y)
  ) {
    nextX = leftSurface + PONG_BALL_RADIUS;
    velocityX = Math.abs(velocityX);
    velocityY = bouncedVelocityY(nextY, paddles[0].y);
  } else if (
    velocityX > 0 &&
    state.ball.x + PONG_BALL_RADIUS <= rightSurface &&
    nextX + PONG_BALL_RADIUS >= rightSurface &&
    paddleHit(nextY, paddles[1].y)
  ) {
    nextX = rightSurface - PONG_BALL_RADIUS;
    velocityX = -Math.abs(velocityX);
    velocityY = bouncedVelocityY(nextY, paddles[1].y);
  }

  const scores: [number, number] = [...state.scores];
  let rng = context.rng as RealtimeRngState;
  let ball: PongState["ball"] = Object.freeze({
    x: nextX,
    y: nextY,
    velocityX,
    velocityY,
  });
  const scorerIndex =
    nextX + PONG_BALL_RADIUS < 0
      ? 1
      : nextX - PONG_BALL_RADIUS > PONG_FIELD_WIDTH
        ? 0
        : null;
  if (scorerIndex !== null) {
    scores[scorerIndex] += 1;
    if (scores[scorerIndex] < state.targetScore) {
      const served = serveBall(rng);
      ball = served.ball;
      rng = served.rng;
    }
  }

  return {
    state: freezeState({
      ...state,
      tick: state.tick + 1,
      paddles,
      ball,
      scores,
      resignedSlotId: null,
    }),
    rng,
  };
}

export function projectView(context: {
  readonly state: Readonly<PongState>;
  readonly viewer: {
    readonly kind: "player";
    readonly slotId: RealtimePlayerSlotId;
  };
}): PongView {
  const state = freezeState(context.state);
  const input = {
    field: { width: PONG_FIELD_WIDTH, height: PONG_FIELD_HEIGHT },
    players: [
      { slotId: state.players[0], side: "LEFT" },
      { slotId: state.players[1], side: "RIGHT" },
    ],
    paddles: [
      { y: state.paddles[0].y, height: PONG_PADDLE_HEIGHT },
      { y: state.paddles[1].y, height: PONG_PADDLE_HEIGHT },
    ],
    ball: { x: state.ball.x, y: state.ball.y, radius: PONG_BALL_RADIUS },
    scores: state.scores,
    tick: state.tick,
    targetScore: state.targetScore,
    yourSide:
      context.viewer.slotId === state.players[0]
        ? "LEFT"
        : context.viewer.slotId === state.players[1]
          ? "RIGHT"
          : null,
    outcome: getOutcome(state),
  };
  const parsed = pongViewSchema.parse(input);
  return Object.freeze({
    ...parsed,
    field: Object.freeze({ ...parsed.field }),
    players: Object.freeze(
      parsed.players.map((player) => Object.freeze({ ...player })),
    ) as PongView["players"],
    paddles: Object.freeze(
      parsed.paddles.map((paddle) => Object.freeze({ ...paddle })),
    ) as PongView["paddles"],
    ball: Object.freeze({ ...parsed.ball }),
    scores: Object.freeze([...parsed.scores]) as readonly [number, number],
    outcome:
      parsed.outcome === null
        ? null
        : freezeOutcome(parsed.outcome as unknown as PongOutcome),
  }) as PongView;
}

export const pongDefinition = Object.freeze({
  manifest: pongManifest,
  configSchema: pongConfigSchema,
  inputSchema: pongInputSchema,
  createInitialState,
  step,
  projectView,
  getOutcome,
}) satisfies RealtimeGameDefinition<
  PongConfig,
  PongState,
  PongInput,
  PongView,
  PongOutcome
>;
