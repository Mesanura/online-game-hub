"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, GameController } from "@phosphor-icons/react";

import { gameCatalog } from "@online-game-hub/game-registry/catalog";

export default function GamesPage() {
  return (
    <div className="page-shell catalog-page">
      <div className="catalog-heading">
        <div>
          <p className="eyebrow">游戏目录</p>
          <h1>选择一款游戏</h1>
          <p>挑一款熟悉的棋盘游戏，创建房间并邀请朋友。</p>
        </div>
        <Link className="clay-button clay-button-secondary" href="/">
          <ArrowLeft size={18} weight="bold" aria-hidden="true" /> 返回首页
        </Link>
      </div>
      <div className="catalog-grid">
        {gameCatalog.map((game) => (
          <article
            className="game-card catalog-card clay-surface"
            key={game.id}
          >
            <div className="game-card-icon" aria-hidden="true">
              <GameController size={32} weight="duotone" />
            </div>
            <div className="game-card-meta">
              <span>
                {game.minPlayers}–{game.maxPlayers} 位玩家
              </span>
              <span>回合制</span>
            </div>
            <h2>{game.title}</h2>
            <p>{game.description}</p>
            <Link className="card-link" href={`/games/${game.id}`}>
              创建或加入房间{" "}
              <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
