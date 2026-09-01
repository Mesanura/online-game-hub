import { useState } from "react";
import { z } from "zod";

import type {
  GameClientModule,
  GameClientProps,
} from "@online-game-hub/game-client-sdk";

import { REVERSI_BOARD_SIZE, REVERSI_CELL_COUNT } from "../constants.js";
import { reversiManifest } from "../manifest.js";
import type {
  ReversiAction,
  ReversiDisc,
  ReversiOutcome,
  ReversiView,
} from "../types.js";

const slotIdSchema = z.string().min(1);
const cellIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(REVERSI_CELL_COUNT - 1);
const discCountsSchema = z
  .object({
    BLACK: z.number().int().min(0).max(REVERSI_CELL_COUNT),
    WHITE: z.number().int().min(0).max(REVERSI_CELL_COUNT),
  })
  .strict();
const boardSchema = z.array(slotIdSchema.nullable()).length(REVERSI_CELL_COUNT);
const outcomeSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("WIN"),
      winnerSlotId: slotIdSchema,
      discCounts: discCountsSchema,
    })
    .strict(),
  z.object({ type: z.literal("DRAW"), discCounts: discCountsSchema }).strict(),
]);

export const reversiViewSchema = z
  .object({
    players: z.tuple([
      z.object({ slotId: slotIdSchema, disc: z.literal("BLACK") }).strict(),
      z.object({ slotId: slotIdSchema, disc: z.literal("WHITE") }).strict(),
    ]),
    board: boardSchema,
    nextTurnSlotId: slotIdSchema.nullable(),
    legalMoves: z.array(cellIndexSchema),
    discCounts: discCountsSchema,
    outcome: outcomeSchema.nullable(),
    yourDisc: z.enum(["BLACK", "WHITE"]).nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const slots = view.players.map((player) => player.slotId);
    if (slots[0] === slots[1]) {
      context.addIssue({
        code: "custom",
        message: "Reversi viewer slots must be distinct.",
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
    if (new Set(view.legalMoves).size !== view.legalMoves.length) {
      context.addIssue({
        code: "custom",
        message: "Legal moves must be unique.",
        path: ["legalMoves"],
      });
    }
    for (const [index, cell] of view.legalMoves.entries()) {
      if (view.board[cell] !== null) {
        context.addIssue({
          code: "custom",
          message: "Legal moves must reference empty cells.",
          path: ["legalMoves", index],
        });
      }
    }
    const blackCount = view.board.filter((owner) => owner === slots[0]).length;
    const whiteCount = view.board.filter((owner) => owner === slots[1]).length;
    if (
      blackCount !== view.discCounts.BLACK ||
      whiteCount !== view.discCounts.WHITE
    ) {
      context.addIssue({
        code: "custom",
        message: "Disc counts must match the visible board.",
        path: ["discCounts"],
      });
    }
    if (view.outcome === null) {
      if (view.nextTurnSlotId === null || view.legalMoves.length === 0) {
        context.addIssue({
          code: "custom",
          message: "An active view must expose a turn and legal moves.",
        });
      }
      return;
    }
    if (view.nextTurnSlotId !== null || view.legalMoves.length !== 0) {
      context.addIssue({
        code: "custom",
        message: "A terminal view may not expose another move.",
      });
    }
    if (
      view.outcome.discCounts.BLACK !== view.discCounts.BLACK ||
      view.outcome.discCounts.WHITE !== view.discCounts.WHITE
    ) {
      context.addIssue({
        code: "custom",
        message: "Outcome counts must match the visible counts.",
        path: ["outcome", "discCounts"],
      });
    }
    if (view.outcome.type === "DRAW" && blackCount !== whiteCount) {
      context.addIssue({
        code: "custom",
        message: "A draw requires equal disc counts.",
        path: ["outcome"],
      });
    }
    if (view.outcome.type === "WIN") {
      const winnerIndex = slots.indexOf(view.outcome.winnerSlotId);
      const winnerHasMore =
        winnerIndex === 0
          ? blackCount > whiteCount
          : winnerIndex === 1
            ? whiteCount > blackCount
            : false;
      if (!winnerHasMore) {
        context.addIssue({
          code: "custom",
          message: "The winner must be the visible player with more discs.",
          path: ["outcome", "winnerSlotId"],
        });
      }
    }
  });

function discForSlot(
  view: Readonly<ReversiView>,
  slotId: string | null,
): ReversiDisc | null {
  if (slotId === null) return null;
  return view.players.find((player) => player.slotId === slotId)?.disc ?? null;
}

function discLabel(disc: ReversiDisc): string {
  return disc === "BLACK" ? "黑方" : "白方";
}

function outcomeLabel(
  view: Readonly<ReversiView>,
  outcome: Readonly<ReversiOutcome>,
): string {
  const score = `${outcome.discCounts.BLACK} 比 ${outcome.discCounts.WHITE}`;
  if (outcome.type === "DRAW") return `平局（${score}）`;
  const winnerDisc = discForSlot(view, outcome.winnerSlotId);
  if (winnerDisc === null) return `比赛已分出胜负（${score}）`;
  if (view.yourDisc === null)
    return `胜者：${discLabel(winnerDisc)}（${score}）`;
  return `胜者：${view.yourDisc === winnerDisc ? "你" : "对手"}（${discLabel(winnerDisc)}，${score}）`;
}

function coordinateLabel(cell: number): string {
  const row = Math.floor(cell / REVERSI_BOARD_SIZE);
  const column = cell % REVERSI_BOARD_SIZE;
  return `${String.fromCharCode(65 + column)}${row + 1}`;
}

export function createPlaceDiscIntent(cell: number): ReversiAction {
  return { type: "PLACE_DISC", cell };
}

export function ReversiClient(
  props: GameClientProps<ReversiView, ReversiAction>,
) {
  const [submitting, setSubmitting] = useState(false);
  const yourPlayer = props.view.players.find(
    (player) => player.disc === props.view.yourDisc,
  );
  const isYourTurn =
    yourPlayer !== undefined &&
    yourPlayer.slotId === props.view.nextTurnSlotId &&
    props.view.outcome === null;
  const legalMoves = new Set(props.view.legalMoves);
  const nextDisc = discForSlot(props.view, props.view.nextTurnSlotId);
  const outcomeText =
    props.view.outcome === null
      ? null
      : outcomeLabel(props.view, props.view.outcome);

  const submitCell = async (cell: number): Promise<void> => {
    setSubmitting(true);
    try {
      await props.submitAction(createPlaceDiscIntent(cell));
    } catch {
      // The generic host renders authoritative rejection and transport errors.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="reversi-heading" className="game-board-panel">
      <h2 className="sr-only" id="reversi-heading">
        黑白棋棋盘
      </h2>
      <p data-testid="player-color">
        {props.view.yourDisc === null
          ? "你正在旁观"
          : `你的棋子：${discLabel(props.view.yourDisc)}`}
      </p>
      <div aria-label="棋子数量" className="reversi-score" role="group">
        <span data-testid="black-disc-count">
          黑方：{props.view.discCounts.BLACK}
        </span>
        <span data-testid="white-disc-count">
          白方：{props.view.discCounts.WHITE}
        </span>
      </div>
      <p aria-live="polite" data-testid="turn-status">
        {outcomeText ??
          (nextDisc === null
            ? "等待服务器同步回合"
            : isYourTurn
              ? "轮到你落子"
              : `当前回合：${discLabel(nextDisc)}`)}
      </p>
      <div className="reversi-board-scroll">
        <div
          aria-colcount={REVERSI_BOARD_SIZE}
          aria-label="黑白棋棋盘"
          aria-rowcount={REVERSI_BOARD_SIZE}
          className="reversi-board"
          role="grid"
        >
          {props.view.board.map((slotId, cell) => {
            const disc = discForSlot(props.view, slotId);
            const legalMove = legalMoves.has(cell);
            const coordinate = coordinateLabel(cell);
            return (
              <button
                aria-label={`${coordinate}，${disc === null ? (legalMove ? "空，合法落点" : "空") : discLabel(disc)}`}
                className="reversi-cell"
                data-cell-index={cell}
                data-coordinate={coordinate}
                data-disc={disc ?? "EMPTY"}
                data-legal-move={legalMove ? "true" : "false"}
                disabled={
                  props.connectionState !== "connected" ||
                  submitting ||
                  !isYourTurn ||
                  !legalMove
                }
                key={cell}
                onClick={() => void submitCell(cell)}
                role="gridcell"
                type="button"
              >
                {disc === null ? (
                  legalMove ? (
                    <span aria-hidden="true" className="reversi-legal-marker" />
                  ) : null
                ) : (
                  <span
                    aria-hidden="true"
                    className="reversi-disc"
                    data-disc-color={disc}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export const reversiClientModule = {
  gameId: reversiManifest.id,
  gameVersion: reversiManifest.gameVersion,
  parseView(input) {
    return reversiViewSchema.parse(input) as unknown as ReversiView;
  },
  Component: ReversiClient,
} satisfies GameClientModule<ReversiView, ReversiAction>;
