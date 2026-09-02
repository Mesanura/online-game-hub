"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { gameCatalog } from "@online-game-hub/game-registry/catalog";

type Match = {
  matchId: string;
  roundNumber: number;
  gameId: string;
  gameVersion: string;
  status: string;
  finalRevision: number;
  createdAt: string;
  finishedAt: string | null;
  replayAvailable: boolean;
};

const statusLabels: Record<string, string> = {
  completed: "已完成",
  abandoned: "已中止",
  active: "进行中",
  waiting: "等待中",
};

export default function AccountMatchesPage() {
  const router = useRouter();
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    void fetch("/api/matches", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          setUnauthorized(true);
          router.replace("/login?next=%2Faccount%2Fmatches");
          return;
        }
        const payload = (await response.json()) as { matches?: Match[] };
        setMatches(payload.matches ?? []);
      })
      .catch(() => {
        setLoadError(true);
        setMatches([]);
      });
  }, [router]);
  if (unauthorized)
    return (
      <div className="page-shell auth-page">
        <h1>请先登录</h1>
        <p>游客可以完整游玩，但不会保存可见的账户历史。</p>
        <Link className="clay-button clay-button-primary" href="/login">
          去登录
        </Link>
      </div>
    );
  return (
    <div className="page-shell history-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">账户历史</p>
          <h1>我的对局</h1>
        </div>
        <Link className="text-link" href="/account">
          账户设置
        </Link>
      </div>
      {matches === null ? (
        <p data-testid="history-loading">加载中…</p>
      ) : loadError ? (
        <div className="empty-state clay-surface" role="alert">
          <h2>历史加载失败</h2>
          <p>暂时无法读取你的对局记录。</p>
        </div>
      ) : matches.length === 0 ? (
        <div className="empty-state clay-surface">
          <h2>还没有登录态对局</h2>
          <p>登录后开始的新对局会出现在这里。此前的游客对局不会被认领。</p>
          <Link className="clay-button clay-button-primary" href="/games">
            开始一局
          </Link>
        </div>
      ) : (
        <div className="history-list">
          {matches.map((match) => (
            <article className="history-row clay-surface" key={match.matchId}>
              <div>
                <strong>
                  {gameCatalog.find((game) => game.id === match.gameId)
                    ?.title ?? "历史对局"}
                </strong>
                <span>
                  第 {match.roundNumber} 局 ·{" "}
                  {statusLabels[match.status] ?? "状态未知"}
                </span>
              </div>
              <div>
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
    </div>
  );
}
