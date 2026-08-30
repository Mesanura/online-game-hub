import { useState } from "react";
import { z } from "zod";

import type {
  GameClientModule,
  GameClientProps,
} from "@online-game-hub/game-client-sdk";

import {
  CONNECT_FOUR_CELL_COUNT,
  CONNECT_FOUR_COLUMNS,
  CONNECT_FOUR_ROWS,
} from "../constants.js";
import { connectFourManifest } from "../manifest.js";
import type {
  ConnectFourAction,
  ConnectFourDisc,
  ConnectFourView,
} from "../types.js";

const slotIdSchema = z.string().min(1);
const cellIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(CONNECT_FOUR_CELL_COUNT - 1);
const boardSchema = z
  .array(slotIdSchema.nullable())
  .length(CONNECT_FOUR_CELL_COUNT);
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
      ]),
    })
    .strict(),
  z.object({ type: z.literal("DRAW") }).strict(),
]);

export const connectFourViewSchema = z
  .object({
    players: z.tuple([
      z.object({ slotId: slotIdSchema, disc: z.literal("RED") }).strict(),
      z.object({ slotId: slotIdSchema, disc: z.literal("YELLOW") }).strict(),
    ]),
    board: boardSchema,
    nextTurnSlotId: slotIdSchema.nullable(),
    outcome: outcomeSchema.nullable(),
    yourDisc: z.enum(["RED", "YELLOW"]).nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const slots = view.players.map((player) => player.slotId);
    if (slots[0] === slots[1]) {
      context.addIssue({
        code: "custom",
        message: "Connect Four viewer slots must be distinct.",
        path: ["players"],
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
  });

function discForSlot(
  view: Readonly<ConnectFourView>,
  slotId: string | null,
): ConnectFourDisc | null {
  if (slotId === null) return null;
  return view.players.find((player) => player.slotId === slotId)?.disc ?? null;
}

function discLabel(disc: ConnectFourDisc): string {
  return disc === "RED" ? "红方" : "黄方";
}

function outcomeLabel(view: Readonly<ConnectFourView>): string | null {
  if (view.outcome === null) return null;
  if (view.outcome.type === "DRAW") return "平局";

  const winnerDisc = discForSlot(view, view.outcome.winnerSlotId);
  if (winnerDisc === null) return "比赛已分出胜负";
  if (view.yourDisc === null) return `胜者：${discLabel(winnerDisc)}`;
  return `胜者：${view.yourDisc === winnerDisc ? "你" : "对手"}（${discLabel(winnerDisc)}）`;
}

export function createDropDiscIntent(column: number): ConnectFourAction {
  return { type: "DROP_DISC", column };
}

export function ConnectFourClient(
  props: GameClientProps<ConnectFourView, ConnectFourAction>,
) {
  const [submitting, setSubmitting] = useState(false);
  const yourPlayer = props.view.players.find(
    (player) => player.disc === props.view.yourDisc,
  );
  const isYourTurn =
    yourPlayer !== undefined &&
    yourPlayer.slotId === props.view.nextTurnSlotId &&
    props.view.outcome === null;
  const nextDisc = discForSlot(props.view, props.view.nextTurnSlotId);
  const outcomeText = outcomeLabel(props.view);
  const winningCells =
    props.view.outcome?.type === "WIN"
      ? new Set<number>(props.view.outcome.winningCells)
      : new Set<number>();

  const submitColumn = async (column: number): Promise<void> => {
    setSubmitting(true);
    try {
      await props.submitAction(createDropDiscIntent(column));
    } catch {
      // Authoritative rejection/error state is rendered by the generic host.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-labelledby="connect-four-heading"
      className="game-board-panel"
    >
      <div className="game-status-row">
        <h2 id="connect-four-heading">7 × 6 棋盘</h2>
        <span data-testid="revision">Revision {props.revision}</span>
      </div>
      <p data-testid="player-disc">
        {props.view.yourDisc === null
          ? "你正在旁观"
          : `你的棋子：${discLabel(props.view.yourDisc)}`}
      </p>
      <p aria-live="polite" data-testid="turn-status">
        {outcomeText ??
          (nextDisc === null
            ? "等待服务器同步回合"
            : isYourTurn
              ? "轮到你选择一列"
              : `当前回合：${discLabel(nextDisc)}`)}
      </p>
      <div
        aria-label="选择落子列"
        className="connect-four-column-controls"
        role="group"
      >
        {Array.from({ length: CONNECT_FOUR_COLUMNS }, (_, column) => (
          <button
            aria-label={`第 ${column + 1} 列落子`}
            data-column-index={column}
            disabled={
              props.connectionState !== "connected" ||
              submitting ||
              !isYourTurn ||
              props.view.board[column] !== null
            }
            key={column}
            onClick={() => void submitColumn(column)}
            type="button"
          >
            ↓
          </button>
        ))}
      </div>
      <div
        aria-colcount={CONNECT_FOUR_COLUMNS}
        aria-label="Connect Four 棋盘"
        aria-rowcount={CONNECT_FOUR_ROWS}
        className="connect-four-board"
        role="grid"
      >
        {props.view.board.map((slotId, cell) => {
          const disc = discForSlot(props.view, slotId);
          const row = Math.floor(cell / CONNECT_FOUR_COLUMNS);
          const column = cell % CONNECT_FOUR_COLUMNS;
          return (
            <div
              aria-label={`第 ${row + 1} 行第 ${column + 1} 列，${disc === null ? "空" : discLabel(disc)}`}
              className={
                winningCells.has(cell)
                  ? "connect-four-cell winning-cell"
                  : "connect-four-cell"
              }
              data-cell-index={cell}
              data-disc={disc ?? "EMPTY"}
              key={cell}
              role="gridcell"
            />
          );
        })}
      </div>
    </section>
  );
}

export const connectFourClientModule = {
  gameId: connectFourManifest.id,
  gameVersion: connectFourManifest.gameVersion,
  parseView(input) {
    return connectFourViewSchema.parse(input) as unknown as ConnectFourView;
  },
  Component: ConnectFourClient,
} satisfies GameClientModule<ConnectFourView, ConnectFourAction>;
