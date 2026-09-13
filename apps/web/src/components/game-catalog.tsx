"use client";

import { useSearchParams } from "next/navigation";
import { gameCatalog } from "@online-game-hub/game-registry/catalog";
import { filterCatalog, readCatalogFilters } from "../lib/catalog-filters";
import { replaceQueryParameters } from "../lib/page-query";
import { GameCard } from "./game-card";

function clearFilters() {
  replaceQueryParameters({ q: null, runtime: null, players: null });
}

export function GameCatalog() {
  const params = useSearchParams();
  const filters = readCatalogFilters(params);
  const games = filterCatalog(gameCatalog, filters);
  const hasFilters = ["q", "runtime", "players"].some((key) => params.has(key));

  return (
    <>
      <div
        className="list-filters clay-surface"
        role="search"
        aria-label="筛选游戏"
      >
        <label className="list-filter-field list-filter-search">
          搜索游戏
          <input
            autoComplete="off"
            name="q"
            onChange={(event) =>
              replaceQueryParameters({ q: event.target.value })
            }
            placeholder="搜索游戏名称或简介"
            type="search"
            value={filters.query}
          />
        </label>
        <label className="list-filter-field">
          游戏类型
          <select
            name="runtime"
            onChange={(event) =>
              replaceQueryParameters({ runtime: event.target.value })
            }
            value={filters.runtime ?? ""}
          >
            <option value="">全部类型</option>
            <option value="turn-based">回合制</option>
            <option value="realtime">实时对战</option>
          </select>
        </label>
        <label className="list-filter-field">
          游玩人数
          <select
            name="players"
            onChange={(event) =>
              replaceQueryParameters({ players: event.target.value })
            }
            value={filters.players ?? ""}
          >
            <option value="">不限人数</option>
            {[2, 3, 4, 5, 6, 7, 8].map((count) => (
              <option key={count} value={count}>
                {count} 人
              </option>
            ))}
          </select>
        </label>
        <button
          className="clay-button clay-button-secondary"
          disabled={!hasFilters}
          onClick={clearFilters}
          type="button"
        >
          清空筛选
        </button>
      </div>
      <p className="list-result-count" role="status" aria-atomic="true">
        找到 {games.length} / {gameCatalog.length} 款游戏
      </p>
      {games.length === 0 ? (
        <section
          className="empty-state clay-surface"
          aria-labelledby="catalog-empty-title"
        >
          <h2 id="catalog-empty-title">没有匹配的游戏</h2>
          <p>换个关键词或筛选条件，看看其他适合一起玩的游戏。</p>
          <button
            className="clay-button clay-button-primary"
            onClick={clearFilters}
            type="button"
          >
            查看全部游戏
          </button>
        </section>
      ) : (
        <div className="catalog-grid">
          {games.map((game) => (
            <GameCard game={game} key={game.id} variant="catalog" />
          ))}
        </div>
      )}
    </>
  );
}
