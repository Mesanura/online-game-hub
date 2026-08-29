import { useState } from "react";
import { z } from "zod";

import type {
  GameClientModule,
  GameClientProps,
} from "@online-game-hub/game-client-sdk";

import type {
  TicTacToeAction,
  TicTacToeCellIndex,
  TicTacToeView,
} from "../core/index.js";
import { ticTacToeManifest } from "../manifest.js";

const cellIndexSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
]);

const boardSchema = z.tuple([
  z.string().min(1).nullable(),
  z.string().min(1).nullable(),
  z.string().min(1).nullable(),
  z.string().min(1).nullable(),
  z.string().min(1).nullable(),
  z.string().min(1).nullable(),
  z.string().min(1).nullable(),
  z.string().min(1).nullable(),
  z.string().min(1).nullable(),
]);

const outcomeSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("WIN"),
      winnerSlotId: z.string().min(1),
      winningCells: z.tuple([
        cellIndexSchema,
        cellIndexSchema,
        cellIndexSchema,
      ]),
    })
    .strict(),
  z.object({ type: z.literal("DRAW") }).strict(),
]);

export const ticTacToeViewSchema = z
  .object({
    players: z.tuple([
      z.object({ slotId: z.string().min(1), mark: z.literal("X") }).strict(),
      z.object({ slotId: z.string().min(1), mark: z.literal("O") }).strict(),
    ]),
    board: boardSchema,
    nextTurnSlotId: z.string().min(1).nullable(),
    outcome: outcomeSchema.nullable(),
    yourMark: z.enum(["X", "O"]).nullable(),
  })
  .strict();

function markForSlot(view: Readonly<TicTacToeView>, slotId: string | null) {
  if (slotId === null) {
    return null;
  }
  return view.players.find((player) => player.slotId === slotId)?.mark ?? null;
}

function outcomeLabel(view: Readonly<TicTacToeView>): string | null {
  const outcome = view.outcome;
  if (outcome === null) {
    return null;
  }
  if (outcome.type === "DRAW") {
    return "平局";
  }
  const winnerMark = markForSlot(view, outcome.winnerSlotId);
  if (view.yourMark === null || winnerMark === null) {
    return "比赛已分出胜负";
  }
  return `胜者：${view.yourMark === winnerMark ? "你" : "对手"}（${winnerMark}）`;
}

export function TicTacToeClient(
  props: GameClientProps<TicTacToeView, TicTacToeAction>,
) {
  const [submitting, setSubmitting] = useState(false);
  const nextMark = markForSlot(props.view, props.view.nextTurnSlotId);
  const yourPlayer = props.view.players.find(
    (player) => player.mark === props.view.yourMark,
  );
  const isYourTurn =
    yourPlayer !== undefined &&
    yourPlayer.slotId === props.view.nextTurnSlotId &&
    props.view.outcome === null;
  const winningCells =
    props.view.outcome?.type === "WIN"
      ? new Set<TicTacToeCellIndex>(props.view.outcome.winningCells)
      : new Set<TicTacToeCellIndex>();
  const outcomeText = outcomeLabel(props.view);

  const submitCell = async (cell: TicTacToeCellIndex): Promise<void> => {
    setSubmitting(true);
    try {
      await props.submitAction({ type: "PLACE_MARK", cell });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="tic-tac-toe-heading" className="game-board-panel">
      <div className="game-status-row">
        <h2 id="tic-tac-toe-heading">3 × 3 棋盘</h2>
        <span data-testid="revision">Revision {props.revision}</span>
      </div>
      <p data-testid="player-mark">
        {props.view.yourMark === null
          ? "你正在旁观"
          : `你的棋子：${props.view.yourMark}`}
      </p>
      <p data-testid="turn-status" aria-live="polite">
        {outcomeText ??
          (nextMark === null
            ? "等待服务器同步回合"
            : isYourTurn
              ? "轮到你落子"
              : `当前回合：${nextMark}`)}
      </p>
      <div
        aria-label="Tic-Tac-Toe 棋盘"
        className="tic-tac-toe-board"
        role="grid"
      >
        {props.view.board.map((slotId, cell) => {
          const cellIndex = cell as TicTacToeCellIndex;
          const mark = markForSlot(props.view, slotId);
          return (
            <button
              aria-label={`格子 ${cell + 1}${mark === null ? "，空" : `，${mark}`}`}
              className={
                winningCells.has(cellIndex) ? "winning-cell" : undefined
              }
              data-cell-index={cell}
              disabled={
                props.connectionState !== "connected" ||
                submitting ||
                !isYourTurn ||
                slotId !== null
              }
              key={cell}
              onClick={() => void submitCell(cellIndex)}
              role="gridcell"
              type="button"
            >
              {mark ?? ""}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export const ticTacToeClientModule = {
  gameId: ticTacToeManifest.id,
  gameVersion: ticTacToeManifest.gameVersion,
  parseView(input) {
    return ticTacToeViewSchema.parse(input) as unknown as TicTacToeView;
  },
  Component: TicTacToeClient,
} satisfies GameClientModule<TicTacToeView, TicTacToeAction>;
