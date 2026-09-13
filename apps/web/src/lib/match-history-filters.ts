import { gameCatalog } from "@online-game-hub/game-registry/catalog";
import type { AccountMatchHistoryItem } from "./match-history";

export const historyStatusLabels = {
  completed: "已完成",
  abandoned: "已中止",
  active: "进行中",
  waiting: "等待中",
} satisfies Record<AccountMatchHistoryItem["status"], string>;

interface HistoryGameOption {
  readonly id: string;
  readonly title: string;
}

interface HistoryFilters {
  readonly game: string | null;
  readonly status: AccountMatchHistoryItem["status"] | null;
}

export function getHistoryGameOptions(
  matches: readonly AccountMatchHistoryItem[],
): readonly HistoryGameOption[] {
  const games = new Map<string, HistoryGameOption>(
    gameCatalog.map((game) => [game.id, { id: game.id, title: game.title }]),
  );
  for (const match of matches) {
    if (!games.has(match.gameId)) {
      games.set(match.gameId, {
        id: match.gameId,
        title: `历史游戏（${match.gameId}）`,
      });
    }
  }
  return [...games.values()];
}

export function readHistoryFilters(
  params: Pick<URLSearchParams, "get">,
  games: readonly HistoryGameOption[],
): HistoryFilters {
  const game = params.get("game");
  const status = params.get("status");
  return {
    game: games.some((option) => option.id === game) ? game : null,
    status:
      status !== null && Object.hasOwn(historyStatusLabels, status)
        ? (status as AccountMatchHistoryItem["status"])
        : null,
  };
}

export function filterMatchHistory(
  matches: readonly AccountMatchHistoryItem[],
  filters: HistoryFilters,
): readonly AccountMatchHistoryItem[] {
  return matches.filter(
    (match) =>
      (filters.game === null || match.gameId === filters.game) &&
      (filters.status === null || match.status === filters.status),
  );
}
