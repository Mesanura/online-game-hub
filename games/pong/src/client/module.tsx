"use client";

import { useEffect, useRef } from "react";
import { z } from "zod";
import type { Game, GameObjects } from "phaser";

import type {
  RealtimeGameClientModule,
  RealtimeGameClientProps,
} from "@online-game-hub/realtime-game-client-sdk";
import { interpolationAlpha } from "@online-game-hub/realtime-game-client-sdk";

import {
  PONG_BALL_RADIUS,
  PONG_FIELD_HEIGHT,
  PONG_FIELD_WIDTH,
  PONG_LEFT_PADDLE_X,
  PONG_PADDLE_HEIGHT,
  PONG_PADDLE_WIDTH,
  PONG_RIGHT_PADDLE_X,
} from "../constants.js";
import { pongManifest } from "../manifest.js";
import type { PongInput, PongView } from "../types.js";

const slotSchema = z.string().min(1);
const scoreSchema = z.number().int().min(0).max(9);
const pongClientOutcomeSchema = z.union([
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

export const pongClientViewSchema = z
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
        .object({
          y: z.number().int(),
          height: z.literal(PONG_PADDLE_HEIGHT),
        })
        .strict(),
      z
        .object({
          y: z.number().int(),
          height: z.literal(PONG_PADDLE_HEIGHT),
        })
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
    outcome: pongClientOutcomeSchema.nullable(),
  })
  .strict();

interface RenderState {
  current: Readonly<PongView>;
  previous: Readonly<PongView> | null;
  receivedAt: number;
  reducedMotion: boolean;
}

function lerp(previous: number, current: number, alpha: number): number {
  return Math.round(previous + (current - previous) * alpha);
}

function winnerText(view: Readonly<PongView>): string {
  const outcome = view.outcome;
  if (outcome === null) return "";
  const youWon =
    view.yourSide === "LEFT"
      ? outcome.winnerSlotId === view.players[0].slotId
      : view.yourSide === "RIGHT"
        ? outcome.winnerSlotId === view.players[1].slotId
        : false;
  if (view.yourSide === null) return "比赛结束";
  return youWon ? "你赢了" : "对手获胜";
}

export function createDirectionIntent(direction: -1 | 0 | 1): PongInput {
  return { type: "DIRECTION", direction };
}

export function createPongResignIntent(): PongInput {
  return { type: "RESIGN" };
}

export function PongClient(
  props: RealtimeGameClientProps<PongView, PongInput>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef(props.submitInput);
  const readOnlyRef = useRef(props.readOnly === true);
  const renderStateRef = useRef<RenderState>({
    current: props.view,
    previous: props.previousView,
    receivedAt: 0,
    reducedMotion: props.reducedMotion,
  });

  useEffect(() => {
    submitRef.current = props.submitInput;
    readOnlyRef.current = props.readOnly === true;
    renderStateRef.current = {
      current: props.view,
      previous: props.previousView,
      receivedAt: globalThis.performance.now(),
      reducedMotion: props.reducedMotion,
    };
  }, [
    props.previousView,
    props.readOnly,
    props.reducedMotion,
    props.submitInput,
    props.view,
  ]);

  useEffect(() => {
    const parent = containerRef.current;
    if (parent === null) return;
    let disposed = false;
    let game: Game | null = null;

    void import("phaser").then(({ default: Phaser }) => {
      if (disposed) return;
      let graphics: GameObjects.Graphics;
      let score: GameObjects.Text;
      let result: GameObjects.Text;
      const pressed = new Set<string>();
      let lastDirection: -1 | 0 | 1 = 0;

      const sendDirection = (direction: -1 | 0 | 1): void => {
        if (readOnlyRef.current || direction === lastDirection) return;
        lastDirection = direction;
        void submitRef.current(createDirectionIntent(direction)).catch(() => {
          // The realtime host exposes authoritative rejection state.
        });
      };
      const recomputeDirection = (): void => {
        const up = pressed.has("ArrowUp") || pressed.has("KeyW");
        const down = pressed.has("ArrowDown") || pressed.has("KeyS");
        sendDirection(up === down ? 0 : up ? -1 : 1);
      };

      game = new Phaser.Game({
        type: Phaser.CANVAS,
        parent,
        width: 800,
        height: 400,
        backgroundColor: "#142827",
        transparent: false,
        render: { antialias: true, pixelArt: false },
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: 800,
          height: 400,
        },
        scene: {
          create() {
            graphics = this.add.graphics();
            score = this.add
              .text(400, 22, "0  :  0", {
                color: "#f8f4e8",
                fontFamily: "system-ui, sans-serif",
                fontSize: "28px",
                fontStyle: "bold",
              })
              .setOrigin(0.5, 0);
            result = this.add
              .text(400, 200, "", {
                align: "center",
                color: "#f8f4e8",
                fontFamily: "system-ui, sans-serif",
                fontSize: "36px",
                fontStyle: "bold",
              })
              .setOrigin(0.5)
              .setDepth(2);
            this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
              if (
                ["ArrowUp", "ArrowDown", "KeyW", "KeyS"].includes(event.code)
              ) {
                event.preventDefault();
                pressed.add(event.code);
                recomputeDirection();
              }
            });
            this.input.keyboard?.on("keyup", (event: KeyboardEvent) => {
              pressed.delete(event.code);
              recomputeDirection();
            });
          },
          update() {
            const state = renderStateRef.current;
            const alpha =
              state.reducedMotion || state.previous === null
                ? 1
                : interpolationAlpha(
                    globalThis.performance.now() - state.receivedAt,
                  );
            const previous = state.previous ?? state.current;
            const ballX = lerp(previous.ball.x, state.current.ball.x, alpha);
            const ballY = lerp(previous.ball.y, state.current.ball.y, alpha);
            const leftY = lerp(
              previous.paddles[0].y,
              state.current.paddles[0].y,
              alpha,
            );
            const rightY = lerp(
              previous.paddles[1].y,
              state.current.paddles[1].y,
              alpha,
            );
            const scaleX = 800 / PONG_FIELD_WIDTH;
            const scaleY = 400 / PONG_FIELD_HEIGHT;
            graphics.clear();
            graphics.lineStyle(2, 0x5e817e, 0.7);
            graphics.lineBetween(400, 0, 400, 400);
            graphics.fillStyle(0xf3b29f, 1);
            graphics.fillRoundedRect(
              (PONG_LEFT_PADDLE_X - PONG_PADDLE_WIDTH / 2) * scaleX,
              (leftY - PONG_PADDLE_HEIGHT / 2) * scaleY,
              PONG_PADDLE_WIDTH * scaleX,
              PONG_PADDLE_HEIGHT * scaleY,
              5,
            );
            graphics.fillStyle(0x7fd0c4, 1);
            graphics.fillRoundedRect(
              (PONG_RIGHT_PADDLE_X - PONG_PADDLE_WIDTH / 2) * scaleX,
              (rightY - PONG_PADDLE_HEIGHT / 2) * scaleY,
              PONG_PADDLE_WIDTH * scaleX,
              PONG_PADDLE_HEIGHT * scaleY,
              5,
            );
            graphics.fillStyle(0xfff4c7, 1);
            graphics.fillCircle(
              ballX * scaleX,
              ballY * scaleY,
              PONG_BALL_RADIUS * scaleX,
            );
            score.setText(
              `${state.current.scores[0]}  :  ${state.current.scores[1]}`,
            );
            result.setText(winnerText(state.current));
          },
        },
      });
    });

    return () => {
      disposed = true;
      game?.destroy(true);
    };
  }, []);

  return (
    <section aria-labelledby="pong-heading" className="pong-panel">
      <h2 className="sr-only" id="pong-heading">
        乒乓对战
      </h2>
      <p aria-live="polite" className="game-status-line">
        {props.view.outcome === null
          ? props.connectionState === "connected"
            ? "比赛进行中"
            : "正在恢复比赛"
          : winnerText(props.view)}
      </p>
      <span className="sr-only" data-testid="score-left">
        {props.view.scores[0]}
      </span>
      <span className="sr-only" data-testid="score-right">
        {props.view.scores[1]}
      </span>
      <span className="sr-only" data-testid="pong-outcome">
        {props.view.outcome === null ? "" : JSON.stringify(props.view.outcome)}
      </span>
      <div
        aria-label="乒乓对战画布"
        className="pong-canvas"
        data-testid="pong-canvas"
        ref={containerRef}
      />
    </section>
  );
}

export const pongClientModule = {
  gameId: pongManifest.id,
  gameVersion: pongManifest.gameVersion,
  parseView(input) {
    return pongClientViewSchema.parse(input) as unknown as PongView;
  },
  createResignInput: createPongResignIntent,
  Component: PongClient,
} satisfies RealtimeGameClientModule<PongView, PongInput>;
