import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { z } from "zod";

import type {
  GameClientModule,
  GameClientProps,
} from "@online-game-hub/game-client-sdk";
import { defineGameVersion } from "@online-game-hub/game-sdk";

import {
  CHINESE_CHECKERS_CAMP_OPTIONS,
  CHINESE_CHECKERS_CELL_COUNT,
} from "../constants.js";
import { CHINESE_CHECKERS_CAMP_CELLS, cellCoordinate } from "../geometry.js";
import { chineseCheckersManifest } from "../manifest.js";
import type {
  ChineseCheckersAction,
  ChineseCheckersCamp,
  ChineseCheckersView,
} from "../types.js";

const slotIdSchema = z.string().min(1);
const campSchema = z.enum(CHINESE_CHECKERS_CAMP_OPTIONS);
const cellSchema = z
  .number()
  .int()
  .min(0)
  .max(CHINESE_CHECKERS_CELL_COUNT - 1);
const rankReasonSchema = z.enum([
  "FINISHED",
  "RESIGNATION",
  "BLOCKED",
  "LAST_REMAINING",
]);
export const chineseCheckersViewSchema = z
  .object({
    players: z
      .array(z.object({ slotId: slotIdSchema, camp: campSchema }).strict())
      .min(2)
      .max(6),
    board: z.array(slotIdSchema.nullable()).length(CHINESE_CHECKERS_CELL_COUNT),
    nextTurnSlotId: slotIdSchema.nullable(),
    legalMoves: z.array(
      z.object({ from: cellSchema, to: cellSchema }).strict(),
    ),
    rankings: z.array(
      z
        .object({
          slotId: slotIdSchema,
          rank: z.number().int().positive(),
          reason: rankReasonSchema,
        })
        .strict(),
    ),
    outcome: z
      .object({
        type: z.literal("RANKING"),
        rankings: z.array(
          z
            .object({
              slotId: slotIdSchema,
              rank: z.number().int().positive(),
              reason: rankReasonSchema,
            })
            .strict(),
        ),
      })
      .strict()
      .nullable(),
    yourCamp: campSchema.nullable(),
  })
  .strict();

const campLabels: Record<ChineseCheckersCamp, string> = {
  N: "北营地",
  NE: "东北营地",
  SE: "东南营地",
  S: "南营地",
  SW: "西南营地",
  NW: "西北营地",
};

const campColors: Record<ChineseCheckersCamp, string> = {
  N: "#ff9f9c",
  NE: "#ffd978",
  SE: "#b7e88e",
  S: "#8ed8ef",
  SW: "#bba6f6",
  NW: "#f4a7d8",
};

function playerForCell(
  view: Readonly<ChineseCheckersView>,
  slotId: string | null,
) {
  return slotId === null
    ? undefined
    : view.players.find((player) => player.slotId === slotId);
}

function moveLabel(from: number, to: number): string {
  return `从棋位 ${from + 1} 移动到棋位 ${to + 1}`;
}

export function createMovePieceIntent(
  from: number,
  to: number,
): ChineseCheckersAction {
  return { type: "MOVE_PIECE", from, to };
}

export function legalTargetsForSelection(
  legalMoves: readonly { readonly from: number; readonly to: number }[],
  selectedCell: number | null,
): readonly number[] {
  if (selectedCell === null) return [];
  return legalMoves
    .filter((move) => move.from === selectedCell)
    .map((move) => move.to);
}

export function ChineseCheckersClient(
  props: GameClientProps<ChineseCheckersView, ChineseCheckersAction>,
) {
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const ownSlotId = useMemo(
    () =>
      props.view.players.find((player) => player.camp === props.view.yourCamp)
        ?.slotId ?? null,
    [props.view.players, props.view.yourCamp],
  );
  const legalTargets = useMemo(() => {
    return new Set(
      legalTargetsForSelection(props.view.legalMoves, selectedCell),
    );
  }, [props.view.legalMoves, selectedCell]);
  const isYourTurn =
    ownSlotId !== null && props.view.nextTurnSlotId === ownSlotId;

  const submitMove = async (from: number, to: number): Promise<void> => {
    setSubmitting(true);
    try {
      await props.submitAction(createMovePieceIntent(from, to));
      setSelectedCell(null);
    } catch {
      // The generic host reports authoritative rejections.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-labelledby="chinese-checkers-heading"
      className="game-board-panel chinese-checkers-panel"
    >
      <h2 className="sr-only" id="chinese-checkers-heading">
        中国跳棋棋盘
      </h2>
      <p
        aria-live="polite"
        className="game-status-line"
        data-testid="turn-status"
      >
        {props.view.outcome !== null
          ? "本局排名已确定"
          : isYourTurn
            ? selectedCell === null
              ? "轮到你行动：选择一枚棋子"
              : "选择高亮的跳跃目标"
            : props.view.nextTurnSlotId === null
              ? "等待服务器同步回合"
              : `当前回合：${props.view.nextTurnSlotId}`}
      </p>
      <div className="chinese-checkers-board-scroll">
        <div
          aria-label="中国跳棋六芒星棋盘"
          className="chinese-checkers-board"
          role="grid"
        >
          {props.view.board.map((slotId, cell) => {
            const coordinate = cellCoordinate(cell);
            if (coordinate === undefined) return null;
            const player = playerForCell(props.view, slotId);
            const camp = player?.camp ?? null;
            const isOwnPiece = slotId !== null && slotId === ownSlotId;
            const isLegalTarget = legalTargets.has(cell);
            const isSelected = selectedCell === cell;
            const campCell = CHINESE_CHECKERS_CAMP_OPTIONS.find((candidate) =>
              CHINESE_CHECKERS_CAMP_CELLS[candidate].includes(cell),
            );
            const style = {
              "--cc-left": `${(coordinate.q + 7 + (coordinate.r + 7) * 0.5) * 2.6}rem`,
              "--cc-top": `${(coordinate.r + 7) * 2.15 + 1.5}rem`,
              "--cc-camp-color":
                campCell === undefined ? "#f7efe7" : campColors[campCell],
            } as CSSProperties;
            return (
              <button
                aria-label={`棋位 ${cell + 1}，${camp === null ? "空位" : `${campLabels[camp]}棋子`}${isLegalTarget ? "，可到达" : ""}`}
                className={`chinese-checkers-cell${isSelected ? " is-selected" : ""}${isLegalTarget ? " is-legal-target" : ""}`}
                data-camp={campCell ?? "CENTER"}
                data-cell-index={cell}
                data-occupied={slotId === null ? "false" : "true"}
                disabled={
                  props.readOnly === true ||
                  props.connectionState !== "connected" ||
                  submitting ||
                  (!isLegalTarget && !(isOwnPiece && isYourTurn))
                }
                key={cell}
                onClick={() => {
                  if (isLegalTarget && selectedCell !== null) {
                    void submitMove(selectedCell, cell);
                  } else if (isOwnPiece && isYourTurn) {
                    setSelectedCell(isSelected ? null : cell);
                  }
                }}
                role="gridcell"
                style={style}
                title={
                  isLegalTarget && selectedCell !== null
                    ? moveLabel(selectedCell, cell)
                    : campCell === undefined
                      ? "中心棋位"
                      : campLabels[campCell]
                }
                type="button"
              >
                {slotId === null ? null : (
                  <span
                    aria-hidden="true"
                    className="chinese-checkers-piece"
                    style={{
                      backgroundColor:
                        camp === null ? "#f7efe7" : campColors[camp],
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
      {props.view.outcome !== null ? (
        <ol aria-label="最终排名" className="chinese-checkers-rankings">
          {props.view.outcome.rankings.map((entry) => (
            <li key={entry.slotId}>
              <strong>第 {entry.rank} 名</strong>
              <span>{entry.slotId}</span>
              <small>
                {entry.reason === "FINISHED"
                  ? "完成目标营地"
                  : entry.reason === "RESIGNATION"
                    ? "投降"
                    : entry.reason === "BLOCKED"
                      ? "无路可走"
                      : "最后一名未排名玩家"}
              </small>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export const chineseCheckersClientModule = {
  gameId: chineseCheckersManifest.id,
  gameVersion: chineseCheckersManifest.gameVersion,
  createResignAction: (): ChineseCheckersAction => ({ type: "RESIGN" }),
  parseView(input: unknown) {
    return chineseCheckersViewSchema.parse(
      input,
    ) as unknown as ChineseCheckersView;
  },
  Component: ChineseCheckersClient,
} satisfies GameClientModule<ChineseCheckersView, ChineseCheckersAction>;

export const chineseCheckersClientModuleV1_0_0 = {
  ...chineseCheckersClientModule,
  gameVersion: defineGameVersion("1.0.0"),
} satisfies GameClientModule<ChineseCheckersView, ChineseCheckersAction>;
