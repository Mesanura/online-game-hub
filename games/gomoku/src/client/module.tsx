import { useState } from "react";
import type { CSSProperties } from "react";
import { z } from "zod";

import type {
  GameClientModule,
  GameClientProps,
} from "@online-game-hub/game-client-sdk";

import { GOMOKU_MAX_CELL_COUNT, GOMOKU_WIN_LENGTH } from "../constants.js";
import { gomokuManifest } from "../manifest.js";
import type { GomokuAction, GomokuStone, GomokuView } from "../types.js";

const slotIdSchema = z.string().min(1);
const cellIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(GOMOKU_MAX_CELL_COUNT - 1);
const boardSchema = z
  .array(slotIdSchema.nullable())
  .min(15 * 15)
  .max(GOMOKU_MAX_CELL_COUNT);
const outcomeSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("WIN"),
      winnerSlotId: slotIdSchema,
      winningCells: z.tuple([
        cellIndexSchema,
        cellIndexSchema,
        cellIndexSchema,
        cellIndexSchema,
        cellIndexSchema,
      ]),
    })
    .strict(),
  z.object({ type: z.literal("DRAW") }).strict(),
]);

export const gomokuViewSchema = z
  .object({
    boardSize: z.union([z.literal(15), z.literal(19)]),
    winLength: z.literal(GOMOKU_WIN_LENGTH),
    players: z.tuple([
      z.object({ slotId: slotIdSchema, stone: z.literal("BLACK") }).strict(),
      z.object({ slotId: slotIdSchema, stone: z.literal("WHITE") }).strict(),
    ]),
    board: boardSchema,
    nextTurnSlotId: slotIdSchema.nullable(),
    outcome: outcomeSchema.nullable(),
    yourStone: z.enum(["BLACK", "WHITE"]).nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const slots = view.players.map((player) => player.slotId);
    if (slots[0] === slots[1]) {
      context.addIssue({
        code: "custom",
        message: "Gomoku viewer slots must be distinct.",
        path: ["players"],
      });
    }
    if (view.board.length !== view.boardSize ** 2) {
      context.addIssue({
        code: "custom",
        message: "Gomoku viewer board length must match its board size.",
        path: ["board"],
      });
    }
    for (const [cell, owner] of view.board.entries()) {
      if (owner !== null && !slots.includes(owner)) {
        context.addIssue({
          code: "custom",
          message: "Board cells may only reference visible player slots.",
          path: ["board", cell],
        });
      }
    }
    if (view.nextTurnSlotId !== null && !slots.includes(view.nextTurnSlotId)) {
      context.addIssue({
        code: "custom",
        message: "The next turn must reference a visible player slot.",
        path: ["nextTurnSlotId"],
      });
    }
    if (
      view.outcome?.type === "WIN" &&
      !slots.includes(view.outcome.winnerSlotId)
    ) {
      context.addIssue({
        code: "custom",
        message: "The winner must reference a visible player slot.",
        path: ["outcome", "winnerSlotId"],
      });
    }
    if (
      view.outcome?.type === "WIN" &&
      view.outcome.winningCells.some(
        (cell) => cell >= view.boardSize * view.boardSize,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Winning cells must be inside the visible board.",
        path: ["outcome", "winningCells"],
      });
    }
  });

function stoneForSlot(
  view: Readonly<GomokuView>,
  slotId: string | null,
): GomokuStone | null {
  if (slotId === null) return null;
  return view.players.find((player) => player.slotId === slotId)?.stone ?? null;
}

function stoneLabel(stone: GomokuStone): string {
  return stone === "BLACK" ? "黑方" : "白方";
}

function outcomeLabel(view: Readonly<GomokuView>): string | null {
  if (view.outcome === null) return null;
  if (view.outcome.type === "DRAW") return "平局";

  const winnerStone = stoneForSlot(view, view.outcome.winnerSlotId);
  if (winnerStone === null) return "比赛已分出胜负";
  if (view.yourStone === null) return `胜者：${stoneLabel(winnerStone)}`;
  return `胜者：${view.yourStone === winnerStone ? "你" : "对手"}（${stoneLabel(winnerStone)}）`;
}

export function createPlaceStoneIntent(cell: number): GomokuAction {
  return { type: "PLACE_STONE", cell };
}

export function GomokuClient(props: GameClientProps<GomokuView, GomokuAction>) {
  const [submitting, setSubmitting] = useState(false);
  const yourPlayer = props.view.players.find(
    (player) => player.stone === props.view.yourStone,
  );
  const isYourTurn =
    yourPlayer !== undefined &&
    yourPlayer.slotId === props.view.nextTurnSlotId &&
    props.view.outcome === null;
  const nextStone = stoneForSlot(props.view, props.view.nextTurnSlotId);
  const outcomeText = outcomeLabel(props.view);
  const winningCells =
    props.view.outcome?.type === "WIN"
      ? new Set<number>(props.view.outcome.winningCells)
      : new Set<number>();
  const boardStyle = {
    "--gomoku-board-size": props.view.boardSize,
  } as CSSProperties;

  const submitCell = async (cell: number): Promise<void> => {
    setSubmitting(true);
    try {
      await props.submitAction(createPlaceStoneIntent(cell));
    } catch {
      // Authoritative rejection/error state is rendered by the generic host.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="gomoku-heading" className="game-board-panel">
      <h2 id="gomoku-heading">
        {props.view.boardSize} × {props.view.boardSize} 棋盘
      </h2>
      <p data-testid="player-stone">
        {props.view.yourStone === null
          ? "你正在旁观"
          : `你的棋子：${stoneLabel(props.view.yourStone)}`}
      </p>
      <p aria-live="polite" data-testid="turn-status">
        {outcomeText ??
          (nextStone === null
            ? "等待服务器同步回合"
            : isYourTurn
              ? "轮到你落子"
              : `当前回合：${stoneLabel(nextStone)}`)}
      </p>
      <div className="gomoku-board-scroll">
        <div
          aria-colcount={props.view.boardSize}
          aria-label="五子棋棋盘"
          aria-rowcount={props.view.boardSize}
          className="gomoku-board"
          role="grid"
          style={boardStyle}
        >
          {props.view.board.map((slotId, cell) => {
            const stone = stoneForSlot(props.view, slotId);
            const row = Math.floor(cell / props.view.boardSize);
            const column = cell % props.view.boardSize;
            return (
              <button
                aria-label={`第 ${row + 1} 行第 ${column + 1} 列，${stone === null ? "空" : stoneLabel(stone)}`}
                className={winningCells.has(cell) ? "winning-cell" : undefined}
                data-cell-index={cell}
                data-stone={stone ?? "EMPTY"}
                disabled={
                  props.connectionState !== "connected" ||
                  submitting ||
                  !isYourTurn ||
                  slotId !== null
                }
                key={cell}
                onClick={() => void submitCell(cell)}
                role="gridcell"
                type="button"
              >
                <span aria-hidden="true">
                  {stone === "BLACK" ? "●" : stone === "WHITE" ? "○" : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export const gomokuClientModule = {
  gameId: gomokuManifest.id,
  gameVersion: gomokuManifest.gameVersion,
  parseView(input) {
    return gomokuViewSchema.parse(input) as unknown as GomokuView;
  },
  Component: GomokuClient,
} satisfies GameClientModule<GomokuView, GomokuAction>;
