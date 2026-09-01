"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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

export default function AccountMatchesPage() {
  const router = useRouter();
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
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
      .catch(() => setMatches([]));
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
        <p>加载中…</p>
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
                <strong>{match.gameId}</strong>
                <span>
                  第 {match.roundNumber} 局 · {match.status}
                </span>
              </div>
              <div>
                <span>版本 {match.gameVersion}</span>
                <span>{match.finalRevision} 次操作</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
