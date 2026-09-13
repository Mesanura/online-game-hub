"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountMatchHistoryItem } from "../lib/match-history";
import {
  filterMatchHistory,
  getHistoryGameOptions,
  historyStatusLabels,
  readHistoryFilters,
} from "../lib/match-history-filters";
import { replaceQueryParameters } from "../lib/page-query";
import { MatchHistoryResultView } from "./match-history-result";

type HistoryLoadState =
  | { readonly status: "loading" | "retrying" | "error" | "unauthorized" }
  | {
      readonly status: "loaded";
      readonly matches: readonly AccountMatchHistoryItem[];
    };

function clearFilters() {
  replaceQueryParameters({ game: null, status: null });
}

export function MatchHistory() {
  const router = useRouter();
  const params = useSearchParams();
  const pendingRequest = useRef<AbortController | null>(null);
  const [state, setState] = useState<HistoryLoadState>({ status: "loading" });

  const loadHistory = useCallback(
    async (retry = false) => {
      if (pendingRequest.current !== null) return;
      const controller = new AbortController();
      pendingRequest.current = controller;
      const isCurrent = () =>
        pendingRequest.current === controller && !controller.signal.aborted;
      setState({ status: retry ? "retrying" : "loading" });
      try {
        const response = await fetch("/api/matches", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!isCurrent()) return;
        if (response.status === 401) {
          setState({ status: "unauthorized" });
          router.replace("/login?next=%2Faccount%2Fmatches");
          return;
        }
        if (!response.ok) throw new Error("Match history is unavailable.");
        const payload: unknown = await response.json();
        if (!isCurrent()) return;
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("matches" in payload) ||
          !Array.isArray(payload.matches)
        )
          throw new Error("Match history response is invalid.");
        setState({
          status: "loaded",
          matches: payload.matches as AccountMatchHistoryItem[],
        });
      } catch {
        if (isCurrent()) setState({ status: "error" });
      } finally {
        if (pendingRequest.current === controller)
          pendingRequest.current = null;
      }
    },
    [router],
  );

  useEffect(() => {
    void loadHistory();
    return () => {
      pendingRequest.current?.abort();
      pendingRequest.current = null;
    };
  }, [loadHistory]);

  if (state.status === "unauthorized") {
    return (
      <section className="empty-state clay-surface">
        <h2>请先登录</h2>
        <p>游客可以完整游玩，但不会保存可见的账户历史。</p>
        <Link className="clay-button clay-button-primary" href="/login">
          去登录
        </Link>
      </section>
    );
  }

  const matches = state.status === "loaded" ? state.matches : [];
  const games = getHistoryGameOptions(matches);
  const filters = readHistoryFilters(params, games);
  const visibleMatches = filterMatchHistory(matches, filters);
  const hasFilters = params.has("game") || params.has("status");

  return (
    <>
      <p className="form-hint" id="history-filter-range">
        仅显示最近 50 条对局，筛选在这些记录中进行。
      </p>
      <div
        className="list-filters clay-surface"
        role="group"
        aria-label="筛选对局"
        aria-describedby="history-filter-range"
      >
        <label className="list-filter-field">
          游戏
          <select
            name="game"
            onChange={(event) =>
              replaceQueryParameters({ game: event.target.value })
            }
            value={filters.game ?? ""}
          >
            <option value="">全部游戏</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.title}
              </option>
            ))}
          </select>
        </label>
        <label className="list-filter-field">
          对局状态
          <select
            name="status"
            onChange={(event) =>
              replaceQueryParameters({ status: event.target.value })
            }
            value={filters.status ?? ""}
          >
            <option value="">全部状态</option>
            {Object.entries(historyStatusLabels).map(([status, label]) => (
              <option key={status} value={status}>
                {label}
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
      {state.status === "loading" ? (
        <p
          className="list-result-count"
          data-testid="history-loading"
          role="status"
        >
          加载中…
        </p>
      ) : state.status === "error" || state.status === "retrying" ? (
        <div
          className="empty-state clay-surface history-feedback"
          role={state.status === "error" ? "alert" : "status"}
        >
          <h2>
            {state.status === "retrying" ? "正在重新加载历史" : "历史加载失败"}
          </h2>
          <p>
            {state.status === "retrying"
              ? "正在重新读取你的对局记录…"
              : "暂时无法读取你的对局记录。"}
          </p>
          <button
            className="clay-button clay-button-primary"
            disabled={state.status === "retrying"}
            onClick={() => void loadHistory(true)}
            type="button"
          >
            {state.status === "retrying" ? "重试中…" : "重试"}
          </button>
        </div>
      ) : (
        <>
          <p className="list-result-count" role="status" aria-atomic="true">
            显示 {visibleMatches.length} / {matches.length} 条对局
          </p>
          {matches.length === 0 ? (
            <div className="empty-state clay-surface">
              <h2>还没有登录态对局</h2>
              <p>登录后开始的新对局会出现在这里。此前的游客对局不会被认领。</p>
              <Link className="clay-button clay-button-primary" href="/games">
                开始一局
              </Link>
            </div>
          ) : visibleMatches.length === 0 ? (
            <section
              className="empty-state clay-surface"
              aria-labelledby="history-empty-title"
            >
              <h2 id="history-empty-title">没有匹配的对局</h2>
              <p>最近 50 条记录中没有符合当前条件的对局，试试其他筛选条件。</p>
              <button
                className="clay-button clay-button-primary"
                onClick={clearFilters}
                type="button"
              >
                查看最近对局
              </button>
            </section>
          ) : (
            <div className="history-list">
              {visibleMatches.map((match) => (
                <article
                  className="history-row clay-surface"
                  data-match-id={match.matchId}
                  key={match.matchId}
                >
                  <div className="history-match">
                    <strong>
                      {games.find((game) => game.id === match.gameId)?.title ??
                        "历史对局"}
                    </strong>
                    <span>
                      第 {match.roundNumber} 局 ·{" "}
                      {historyStatusLabels[match.status] ?? "状态未知"}
                    </span>
                  </div>
                  {match.status === "completed" ? (
                    <MatchHistoryResultView result={match.result ?? null} />
                  ) : null}
                  <div className="history-metadata">
                    <span>版本 {match.gameVersion}</span>
                    <span>{match.finalRevision} 次操作</span>
                    <span>
                      {match.finishedAt === null
                        ? "尚未完成"
                        : new Date(match.finishedAt).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  {match.status === "completed" && match.replayAvailable ? (
                    <Link
                      className="clay-button clay-button-primary history-replay-link"
                      data-testid={`replay-entry-${match.matchId}`}
                      href={`/account/matches/${match.matchId}/replay`}
                    >
                      进入回放
                    </Link>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
