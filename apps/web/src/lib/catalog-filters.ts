import type { CatalogGameManifest } from "@online-game-hub/game-registry/catalog";

interface CatalogFilters {
  readonly query: string;
  readonly runtime: CatalogGameManifest["runtime"] | null;
  readonly players: number | null;
}

export function readCatalogFilters(
  params: Pick<URLSearchParams, "get">,
): CatalogFilters {
  const runtime = params.get("runtime");
  const players = params.get("players") ?? "";
  return {
    query: params.get("q") ?? "",
    runtime:
      runtime === "turn-based" || runtime === "realtime" ? runtime : null,
    players: /^[2-8]$/u.test(players) ? Number(players) : null,
  };
}

export function filterCatalog(
  games: readonly CatalogGameManifest[],
  filters: CatalogFilters,
): readonly CatalogGameManifest[] {
  const query = filters.query.trim().toLowerCase();
  return games.filter(
    (game) =>
      (game.title.toLowerCase().includes(query) ||
        game.description.toLowerCase().includes(query)) &&
      (filters.runtime === null || game.runtime === filters.runtime) &&
      (filters.players === null ||
        (game.minPlayers <= filters.players &&
          filters.players <= game.maxPlayers)),
  );
}
