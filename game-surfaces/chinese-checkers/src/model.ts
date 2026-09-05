import type { SurfaceResultSummaryV2 } from "@online-game-hub/game-surface-bridge";

import {
  CHINESE_CHECKERS_CAMPS,
  CHINESE_CHECKERS_CELL_COUNT,
  type ChineseCheckersPlayIntent,
  type ChineseCheckersPlayView,
  type ChineseCheckersSetupIntent,
  type ChineseCheckersSetupView,
} from "./contracts";

export type ChineseCheckersCamp = (typeof CHINESE_CHECKERS_CAMPS)[number];
export type AxialCoordinate = Readonly<{ q: number; r: number }>;

const campLabels: Readonly<Record<ChineseCheckersCamp, string>> = {
  N: "北营地",
  NE: "东北营地",
  SE: "东南营地",
  S: "南营地",
  SW: "西南营地",
  NW: "西北营地",
};

const BOARD_RADIUS = 3;
const directions = [
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
] as const;

function key(coordinate: AxialCoordinate): string {
  return `${coordinate.q},${coordinate.r}`;
}

function add(
  coordinate: AxialCoordinate,
  direction: AxialCoordinate,
  amount: number,
): AxialCoordinate {
  return {
    q: coordinate.q + direction.q * amount,
    r: coordinate.r + direction.r * amount,
  };
}

function inCenter(coordinate: AxialCoordinate): boolean {
  const s = -coordinate.q - coordinate.r;
  return (
    Math.max(Math.abs(coordinate.q), Math.abs(coordinate.r), Math.abs(s)) <=
    BOARD_RADIUS
  );
}

function buildCampCells(camp: ChineseCheckersCamp): readonly AxialCoordinate[] {
  const index = CHINESE_CHECKERS_CAMPS.indexOf(camp);
  const outward = directions[index];
  const tangent = directions[(index + 2) % directions.length];
  if (outward === undefined || tangent === undefined) {
    throw new Error("Invalid Chinese Checkers camp direction.");
  }
  const cells: AxialCoordinate[] = [];
  for (let row = 0; row < 3; row += 1) {
    const base = add({ q: 0, r: 0 }, outward, BOARD_RADIUS + 1 + row);
    for (let offset = 0; offset < 3 - row; offset += 1) {
      cells.push(add(base, tangent, offset));
    }
  }
  return cells;
}

const campCoordinates = Object.fromEntries(
  CHINESE_CHECKERS_CAMPS.map((camp) => [camp, buildCampCells(camp)]),
) as Record<ChineseCheckersCamp, readonly AxialCoordinate[]>;
const coordinateSet = new Map<string, AxialCoordinate>();
for (let q = -6; q <= 6; q += 1) {
  for (let r = -6; r <= 6; r += 1) {
    const coordinate = { q, r };
    if (inCenter(coordinate)) coordinateSet.set(key(coordinate), coordinate);
  }
}
for (const camp of CHINESE_CHECKERS_CAMPS) {
  for (const coordinate of campCoordinates[camp]) {
    coordinateSet.set(key(coordinate), coordinate);
  }
}

export const CHINESE_CHECKERS_COORDINATES = Object.freeze(
  [...coordinateSet.values()].sort(
    (left, right) => left.r - right.r || left.q - right.q,
  ),
);
if (CHINESE_CHECKERS_COORDINATES.length !== CHINESE_CHECKERS_CELL_COUNT) {
  throw new Error("Chinese Checkers Surface geometry must contain 73 cells.");
}
const indexByCoordinate = new Map(
  CHINESE_CHECKERS_COORDINATES.map((coordinate, index) => [
    key(coordinate),
    index,
  ]),
);
const rawPositions = CHINESE_CHECKERS_COORDINATES.map(({ q, r }) => ({
  x: 1.5 * q,
  y: Math.sqrt(3) * (r + q / 2),
}));
const rawXs = rawPositions.map(({ x }) => x);
const rawYs = rawPositions.map(({ y }) => y);
const minimumX = Math.min(...rawXs);
const maximumX = Math.max(...rawXs);
const minimumY = Math.min(...rawYs);
const maximumY = Math.max(...rawYs);

export const CHINESE_CHECKERS_CAMP_CELLS = Object.freeze(
  Object.fromEntries(
    CHINESE_CHECKERS_CAMPS.map((camp) => [
      camp,
      Object.freeze(
        campCoordinates[camp].map((coordinate) => {
          const index = indexByCoordinate.get(key(coordinate));
          if (index === undefined)
            throw new Error("Camp cell is not on board.");
          return index;
        }),
      ),
    ]),
  ) as Record<ChineseCheckersCamp, readonly number[]>,
);

export function campForCell(cell: number): ChineseCheckersCamp | null {
  return (
    CHINESE_CHECKERS_CAMPS.find((camp) =>
      CHINESE_CHECKERS_CAMP_CELLS[camp].includes(cell),
    ) ?? null
  );
}

export function layoutForCell(cell: number): {
  readonly q: number;
  readonly r: number;
  readonly x: number;
  readonly y: number;
} {
  const coordinate = CHINESE_CHECKERS_COORDINATES[cell];
  if (coordinate === undefined)
    throw new RangeError("Cell is outside the board.");
  const rawX = 1.5 * coordinate.q;
  const rawY = Math.sqrt(3) * (coordinate.r + coordinate.q / 2);
  return {
    ...coordinate,
    x: 5 + ((rawX - minimumX) / (maximumX - minimumX)) * 90,
    y: 5 + ((rawY - minimumY) / (maximumY - minimumY)) * 90,
  };
}

export function createPlayerCountIntent(
  playerCount: number,
): ChineseCheckersSetupIntent {
  return { type: "SELECT_PLAYER_COUNT", playerCount };
}

export function createCampIntent(
  camp: ChineseCheckersCamp,
): ChineseCheckersSetupIntent {
  return { type: "SELECT_CAMP", camp };
}

export function createStarterIntent(
  starter: "OWNER" | "NON_OWNER" | "RANDOM",
): ChineseCheckersSetupIntent {
  return { type: "SELECT_STARTER", starter };
}

export function createMovePieceIntent(
  from: number,
  to: number,
): ChineseCheckersPlayIntent {
  return { type: "MOVE_PIECE", from, to };
}

export function createResignIntent(): ChineseCheckersPlayIntent {
  return { type: "RESIGN" };
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

export function setupStatusLabel(
  view: Readonly<ChineseCheckersSetupView>,
): string {
  if (view.participants.length !== view.targetPlayerCount) {
    return `等待 ${view.targetPlayerCount} 位玩家加入（当前 ${view.participants.length} 位）`;
  }
  if (view.participants.some((participant) => participant.camp === null)) {
    return "每位玩家需要选择一个不同的营地";
  }
  if (view.starter === "UNSELECTED") return "房主需要选择本局首位";
  if (view.starter === "FIXED") return "沿用上一局的完整营地与实际顺序";
  return "设置完成，所有参与者可以分别准备";
}

export function campForSlot(
  view: Readonly<ChineseCheckersPlayView>,
  slotId: string | null,
): ChineseCheckersCamp | null {
  if (slotId === null) return null;
  return view.players.find((player) => player.slotId === slotId)?.camp ?? null;
}

export function outcomeLabel(view: Readonly<ChineseCheckersPlayView>): string {
  if (view.outcome === null) return "";
  const winner = view.outcome.rankings.find((entry) => entry.rank === 1);
  if (winner === undefined) return "本局排名已确定";
  const camp = campForSlot(view, winner.slotId);
  if (camp === null) return "本局排名已确定";
  return `第一名：${campLabels[camp]}`;
}

function rankingReasonLabel(
  reason: ChineseCheckersPlayView["rankings"][number]["reason"],
): string {
  if (reason === "FINISHED") return "完成目标营地";
  if (reason === "RESIGNATION") return "投降";
  if (reason === "BLOCKED") return "无路可走";
  return "最后一名未排名玩家";
}

export function resultSummary(
  view: Readonly<ChineseCheckersPlayView>,
): Omit<SurfaceResultSummaryV2, "type" | "stateSequence"> | null {
  if (view.outcome === null) return null;
  const ownSlot =
    view.yourCamp === null
      ? undefined
      : view.players.find((player) => player.camp === view.yourCamp)?.slotId;
  const ownRanking = view.outcome.rankings.find(
    (entry) => entry.slotId === ownSlot,
  );
  return {
    tone:
      ownRanking === undefined
        ? "neutral"
        : ownRanking.rank === 1
          ? "win"
          : "neutral",
    headline:
      ownRanking === undefined
        ? "本局排名已确定"
        : `你获得第 ${ownRanking.rank} 名`,
    details: view.outcome.rankings.map((entry) => {
      const camp = campForSlot(view, entry.slotId);
      const campLabel = camp === null ? "未知营地" : campLabels[camp];
      return `第 ${entry.rank} 名：${campLabel}（${rankingReasonLabel(entry.reason)}）`;
    }),
  };
}
