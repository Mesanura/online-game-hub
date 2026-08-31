import { Fragment, useState } from "react";
import type { CSSProperties } from "react";
import { z } from "zod";

import type {
  GameClientModule,
  GameClientProps,
} from "@online-game-hub/game-client-sdk";

import {
  HEX_BOARD_SIZE,
  HEX_CELL_COUNT,
  HEX_RESIGN_CONFIRMATION_MESSAGE,
} from "../constants.js";
import { hexManifest } from "../manifest.js";
import type { HexAction, HexColor, HexView } from "../types.js";

const slotIdSchema = z.string().min(1);
const cellIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(HEX_CELL_COUNT - 1);
const boardSchema = z.array(slotIdSchema.nullable()).length(HEX_CELL_COUNT);
const outcomeSchema = z.discriminatedUnion("reason", [
  z
    .object({
      type: z.literal("WIN"),
      reason: z.literal("CONNECTION"),
      winnerSlotId: slotIdSchema,
      winningPath: z
        .array(cellIndexSchema)
        .min(HEX_BOARD_SIZE)
        .max(HEX_CELL_COUNT),
    })
    .strict(),
  z
    .object({
      type: z.literal("WIN"),
      reason: z.literal("RESIGNATION"),
      winnerSlotId: slotIdSchema,
      resignedSlotId: slotIdSchema,
    })
    .strict(),
]);

export const hexViewSchema = z
  .object({
    players: z.tuple([
      z.object({ slotId: slotIdSchema, color: z.literal("BLUE") }).strict(),
      z.object({ slotId: slotIdSchema, color: z.literal("RED") }).strict(),
    ]),
    board: boardSchema,
    nextTurnSlotId: slotIdSchema.nullable(),
    outcome: outcomeSchema.nullable(),
    yourColor: z.enum(["BLUE", "RED"]).nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const slots = view.players.map((player) => player.slotId);
    if (slots[0] === slots[1]) {
      context.addIssue({
        code: "custom",
        message: "Hex viewer slots must be distinct.",
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
    if (view.outcome !== null && !slots.includes(view.outcome.winnerSlotId)) {
      context.addIssue({
        code: "custom",
        message: "The winner must reference a visible player slot.",
        path: ["outcome", "winnerSlotId"],
      });
    }
    if (
      view.outcome?.reason === "RESIGNATION" &&
      (!slots.includes(view.outcome.resignedSlotId) ||
        view.outcome.resignedSlotId === view.outcome.winnerSlotId)
    ) {
      context.addIssue({
        code: "custom",
        message: "The resigned slot must be the other visible player.",
        path: ["outcome", "resignedSlotId"],
      });
    }
    if (view.outcome?.reason === "CONNECTION") {
      if (
        new Set(view.outcome.winningPath).size !==
          view.outcome.winningPath.length ||
        view.outcome.winningPath.some(
          (cell) => view.board[cell] !== view.outcome?.winnerSlotId,
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "The winning path must contain unique winner-owned cells.",
          path: ["outcome", "winningPath"],
        });
      }
    }
  });

function colorForSlot(
  view: Readonly<HexView>,
  slotId: string | null,
): HexColor | null {
  if (slotId === null) return null;
  return view.players.find((player) => player.slotId === slotId)?.color ?? null;
}

function colorLabel(color: HexColor): string {
  return color === "BLUE" ? "蓝方" : "红方";
}

function outcomeLabel(view: Readonly<HexView>): string | null {
  const outcome = view.outcome;
  if (outcome === null) return null;
  const winnerColor = colorForSlot(view, outcome.winnerSlotId);
  if (winnerColor === null) return "比赛已分出胜负";
  const winner =
    view.yourColor === null
      ? colorLabel(winnerColor)
      : view.yourColor === winnerColor
        ? `你（${colorLabel(winnerColor)}）`
        : `对手（${colorLabel(winnerColor)}）`;
  return outcome.reason === "CONNECTION"
    ? `胜者：${winner}，已连通对应两边`
    : `胜者：${winner}，对手投降`;
}

function coordinateForCell(cell: number): string {
  const row = Math.floor(cell / HEX_BOARD_SIZE);
  const column = cell % HEX_BOARD_SIZE;
  return `${String.fromCharCode("K".charCodeAt(0) - row)}${column + 1}`;
}

function gridStyle(row: number, column: number): CSSProperties {
  return {
    gridColumn: `${(column - row + HEX_BOARD_SIZE - 1) * 3 + 1} / span 4`,
    gridRow: `${row + column + 1} / span 2`,
  };
}

function edgeCoordinate(
  kind:
    "red-top-left" | "red-bottom-right" | "blue-top-right" | "blue-bottom-left",
  index: number,
) {
  const row =
    kind === "blue-top-right" ? 0 : kind === "blue-bottom-left" ? 10 : index;
  const column =
    kind === "red-top-left" ? 0 : kind === "red-bottom-right" ? 10 : index;
  const label = kind.startsWith("red")
    ? String.fromCharCode("K".charCodeAt(0) - index)
    : String(index + 1);
  return { row, column, label };
}

export function createPlaceStoneIntent(cell: number): HexAction {
  return { type: "PLACE_STONE", cell };
}

export function createResignIntent(): HexAction {
  return { type: "RESIGN" };
}

export function confirmHexResignation(
  confirmAction: (message: string) => boolean,
): boolean {
  return confirmAction(HEX_RESIGN_CONFIRMATION_MESSAGE);
}

export function HexClient(props: GameClientProps<HexView, HexAction>) {
  const [submitting, setSubmitting] = useState(false);
  const yourPlayer = props.view.players.find(
    (player) => player.color === props.view.yourColor,
  );
  const isYourTurn =
    yourPlayer !== undefined &&
    yourPlayer.slotId === props.view.nextTurnSlotId &&
    props.view.outcome === null;
  const nextColor = colorForSlot(props.view, props.view.nextTurnSlotId);
  const outcomeText = outcomeLabel(props.view);
  const winningPath =
    props.view.outcome?.reason === "CONNECTION"
      ? new Set(props.view.outcome.winningPath)
      : new Set<number>();

  const submitIntent = async (action: HexAction): Promise<void> => {
    setSubmitting(true);
    try {
      await props.submitAction(action);
    } catch {
      // Authoritative rejection/error state is rendered by the generic host.
    } finally {
      setSubmitting(false);
    }
  };

  const resign = (): void => {
    if (!confirmHexResignation(window.confirm.bind(window))) return;
    void submitIntent(createResignIntent());
  };

  const edgeKinds = [
    "red-top-left",
    "red-bottom-right",
    "blue-top-right",
    "blue-bottom-left",
  ] as const;

  return (
    <section
      aria-labelledby="hex-heading"
      className="game-board-panel hex-panel"
    >
      <h2 id="hex-heading">11 × 11 棋盘</h2>
      <p data-testid="player-color">
        {props.view.yourColor === null
          ? "你正在旁观"
          : `你的棋子：${colorLabel(props.view.yourColor)}`}
      </p>
      <p aria-live="polite" data-testid="turn-status">
        {outcomeText ??
          (nextColor === null
            ? "等待服务器同步回合"
            : isYourTurn
              ? "轮到你落子"
              : `当前回合：${colorLabel(nextColor)}`)}
      </p>
      <div className="hex-board-scroll">
        <div
          aria-colcount={HEX_BOARD_SIZE}
          aria-label="六贯棋棋盘"
          aria-rowcount={HEX_BOARD_SIZE}
          className="hex-board"
          role="grid"
        >
          {props.view.board.map((slotId, cell) => {
            const color = colorForSlot(props.view, slotId);
            const row = Math.floor(cell / HEX_BOARD_SIZE);
            const column = cell % HEX_BOARD_SIZE;
            const edgeClasses = [
              column === 0 ? "hex-edge-red-top-left" : null,
              column === HEX_BOARD_SIZE - 1
                ? "hex-edge-red-bottom-right"
                : null,
              row === 0 ? "hex-edge-blue-top-right" : null,
              row === HEX_BOARD_SIZE - 1 ? "hex-edge-blue-bottom-left" : null,
            ]
              .filter((value): value is string => value !== null)
              .join(" ");
            return (
              <button
                aria-label={`${coordinateForCell(cell)}，${color === null ? "空" : colorLabel(color)}`}
                className={`hex-cell ${edgeClasses}${winningPath.has(cell) ? " winning-cell" : ""}`}
                data-cell-index={cell}
                data-color={color ?? "EMPTY"}
                data-coordinate={coordinateForCell(cell)}
                disabled={
                  props.connectionState !== "connected" ||
                  submitting ||
                  !isYourTurn ||
                  slotId !== null
                }
                key={cell}
                onClick={() => void submitIntent(createPlaceStoneIntent(cell))}
                role="gridcell"
                style={gridStyle(row, column)}
                type="button"
              >
                {color === null ? null : (
                  <span aria-hidden="true" className="hex-piece" />
                )}
              </button>
            );
          })}
          {edgeKinds.map((kind) => (
            <Fragment key={kind}>
              {Array.from({ length: HEX_BOARD_SIZE }, (_, index) => {
                const coordinate = edgeCoordinate(kind, index);
                return (
                  <span
                    aria-hidden="true"
                    className={`hex-coordinate hex-coordinate-${kind}`}
                    key={`${kind}-${index}`}
                    style={gridStyle(coordinate.row, coordinate.column)}
                  >
                    {coordinate.label}
                  </span>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      {props.view.yourColor === null ? null : (
        <button
          className="danger-button hex-resign-button"
          data-testid="resign-game"
          disabled={
            props.connectionState !== "connected" ||
            submitting ||
            props.view.outcome !== null
          }
          onClick={resign}
          type="button"
        >
          投降
        </button>
      )}
    </section>
  );
}

export const hexClientModule = {
  gameId: hexManifest.id,
  gameVersion: hexManifest.gameVersion,
  parseView(input) {
    return hexViewSchema.parse(input) as unknown as HexView;
  },
  Component: HexClient,
} satisfies GameClientModule<HexView, HexAction>;
