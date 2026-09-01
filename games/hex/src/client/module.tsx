import { useState } from "react";
import type { CSSProperties } from "react";
import { z } from "zod";

import type {
  GameClientModule,
  GameClientProps,
} from "@online-game-hub/game-client-sdk";

import { HEX_BOARD_SIZE, HEX_CELL_COUNT } from "../constants.js";
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
  return `${String.fromCharCode("A".charCodeAt(0) + row)}${column + 1}`;
}

export function hexLayoutForCell(cell: number): {
  readonly row: number;
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly style: CSSProperties;
} {
  const row = Math.floor(cell / HEX_BOARD_SIZE);
  const column = cell % HEX_BOARD_SIZE;
  return {
    row,
    column,
    x: ((row + column) * 3) / 4,
    y: (column - row) / 2,
    style: {
      gridColumn: `${(row + column) * 3 + 1} / span 4`,
      gridRow: `${column - row + HEX_BOARD_SIZE} / span 2`,
    },
  };
}

const hexEdgeKinds = [
  "upper-left",
  "upper-right",
  "lower-right",
  "lower-left",
] as const;

type HexEdgeKind = (typeof hexEdgeKinds)[number];

function edgeCoordinate(kind: HexEdgeKind, index: number) {
  const row = kind === "lower-left" ? 0 : kind === "upper-right" ? 10 : index;
  const column =
    kind === "upper-left" ? 0 : kind === "lower-right" ? 10 : index;
  const label =
    kind === "upper-left" || kind === "lower-right"
      ? String.fromCharCode("A".charCodeAt(0) + index)
      : String(index + 1);
  return { row, column, label };
}

type HexVertex =
  "top-left" | "top-right" | "right" | "bottom-right" | "bottom-left" | "left";

const vertexOffsets: Readonly<Record<HexVertex, readonly [number, number]>> = {
  "top-left": [-0.25, -0.5],
  "top-right": [0.25, -0.5],
  right: [0.5, 0],
  "bottom-right": [0.25, 0.5],
  "bottom-left": [-0.25, 0.5],
  left: [-0.5, 0],
};

function svgPoint(row: number, column: number, vertex: HexVertex): string {
  const layout = hexLayoutForCell(row * HEX_BOARD_SIZE + column);
  const [offsetX, offsetY] = vertexOffsets[vertex];
  return `${(layout.x + 0.5 + offsetX) * 100},${(layout.y + 5.5 + offsetY) * 100}`;
}

export function hexEdgeBandPath(kind: HexEdgeKind): string {
  const points: string[] = [];
  const append = (row: number, column: number, vertex: HexVertex) => {
    const point = svgPoint(row, column, vertex);
    if (points.at(-1) !== point) points.push(point);
  };

  if (kind === "upper-left") {
    append(0, 0, "left");
    for (let row = 0; row < HEX_BOARD_SIZE; row += 1) {
      append(row, 0, "top-left");
      append(row, 0, "top-right");
    }
  } else if (kind === "upper-right") {
    append(HEX_BOARD_SIZE - 1, 0, "top-right");
    for (let column = 0; column < HEX_BOARD_SIZE; column += 1) {
      append(HEX_BOARD_SIZE - 1, column, "right");
      if (column < HEX_BOARD_SIZE - 1) {
        append(HEX_BOARD_SIZE - 1, column + 1, "top-right");
      }
    }
  } else if (kind === "lower-right") {
    append(0, HEX_BOARD_SIZE - 1, "bottom-right");
    for (let row = 0; row < HEX_BOARD_SIZE; row += 1) {
      append(row, HEX_BOARD_SIZE - 1, "right");
      if (row < HEX_BOARD_SIZE - 1) {
        append(row + 1, HEX_BOARD_SIZE - 1, "bottom-right");
      }
    }
  } else {
    append(0, 0, "left");
    for (let column = 0; column < HEX_BOARD_SIZE; column += 1) {
      append(0, column, "bottom-left");
      append(0, column, "bottom-right");
    }
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point}`)
    .join(" ");
}

export function hexCellsShareSide(
  firstCell: number,
  secondCell: number,
): boolean {
  const first = hexLayoutForCell(firstCell);
  const second = hexLayoutForCell(secondCell);
  const deltaX = second.x - first.x;
  const deltaY = second.y - first.y;
  return [
    [-0.75, 0.5],
    [0, 1],
    [-0.75, -0.5],
    [0.75, 0.5],
    [0, -1],
    [0.75, -0.5],
  ].some(([x, y]) => deltaX === x && deltaY === y);
}

export function createPlaceStoneIntent(cell: number): HexAction {
  return { type: "PLACE_STONE", cell };
}

export function createResignIntent(): HexAction {
  return { type: "RESIGN" };
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

  return (
    <section
      aria-labelledby="hex-heading"
      className="game-board-panel hex-panel"
    >
      <h2 className="sr-only" id="hex-heading">
        六贯棋棋盘
      </h2>
      <p className="game-status-line" data-testid="player-color">
        {props.view.yourColor === null
          ? "你正在旁观"
          : `你的棋子：${colorLabel(props.view.yourColor)}`}
        {props.view.yourColor === null ? null : (
          <span
            aria-hidden="true"
            className="game-status-dot"
            data-color={props.view.yourColor}
          />
        )}
      </p>
      <p
        aria-live="polite"
        className="game-status-line"
        data-testid="turn-status"
      >
        {outcomeText ??
          (nextColor === null
            ? "等待服务器同步回合"
            : isYourTurn
              ? "轮到你落子"
              : `当前回合：${colorLabel(nextColor)}`)}
        {outcomeText !== null || nextColor === null ? null : (
          <span
            aria-hidden="true"
            className="game-status-dot"
            data-color={nextColor}
          />
        )}
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
            const layout = hexLayoutForCell(cell);
            return (
              <button
                aria-label={`${coordinateForCell(cell)}，${color === null ? "空" : colorLabel(color)}`}
                className={`hex-cell${winningPath.has(cell) ? " winning-cell" : ""}`}
                data-cell-index={cell}
                data-color={color ?? "EMPTY"}
                data-coordinate={coordinateForCell(cell)}
                data-layout-x={layout.x}
                data-layout-y={layout.y}
                disabled={
                  props.connectionState !== "connected" ||
                  submitting ||
                  !isYourTurn ||
                  slotId !== null
                }
                key={cell}
                onClick={() => void submitIntent(createPlaceStoneIntent(cell))}
                role="gridcell"
                style={layout.style}
                type="button"
              >
                {color === null ? null : (
                  <span aria-hidden="true" className="hex-piece" />
                )}
              </button>
            );
          })}
          <svg
            aria-hidden="true"
            className="hex-edge-bands"
            preserveAspectRatio="none"
            viewBox="0 0 1600 1100"
          >
            <path
              className="hex-edge-band hex-edge-band-red"
              d={hexEdgeBandPath("upper-left")}
            />
            <path
              className="hex-edge-band hex-edge-band-blue"
              d={hexEdgeBandPath("upper-right")}
            />
            <path
              className="hex-edge-band hex-edge-band-red"
              d={hexEdgeBandPath("lower-right")}
            />
            <path
              className="hex-edge-band hex-edge-band-blue"
              d={hexEdgeBandPath("lower-left")}
            />
          </svg>
          {hexEdgeKinds.flatMap((kind) =>
            Array.from({ length: HEX_BOARD_SIZE }, (_, index) => {
              const coordinate = edgeCoordinate(kind, index);
              const layout = hexLayoutForCell(
                coordinate.row * HEX_BOARD_SIZE + coordinate.column,
              );
              return (
                <span
                  aria-hidden="true"
                  className={`hex-coordinate hex-coordinate-${kind}`}
                  key={`${kind}-${index}`}
                  style={layout.style}
                >
                  {coordinate.label}
                </span>
              );
            }),
          )}
        </div>
      </div>
    </section>
  );
}

export const hexClientModule = {
  gameId: hexManifest.id,
  gameVersion: hexManifest.gameVersion,
  parseView(input) {
    return hexViewSchema.parse(input) as unknown as HexView;
  },
  createResignAction: createResignIntent,
  Component: HexClient,
} satisfies GameClientModule<HexView, HexAction>;
