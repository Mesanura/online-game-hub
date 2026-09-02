"use client";

import Link from "next/link";
import {
  ArrowRight,
  GameController,
  Sparkle,
  UsersThree,
} from "@phosphor-icons/react";

import { gameCatalog } from "@online-game-hub/game-registry/catalog";

export default function HomePage() {
  return (
    <div className="page-shell home-page">
      <section className="hero clay-surface">
        <div className="hero-copy">
          <p className="eyebrow">Online Game Hub</p>
          <h1>
            让快乐，
            <br />
            准时开局。
          </h1>
          <p>轻松创建私人房间，随时和朋友来一局。</p>
          <Link
            className="clay-button clay-button-primary hero-cta"
            href="/games"
          >
            浏览游戏 <ArrowRight size={20} weight="bold" aria-hidden="true" />
          </Link>
        </div>
        <div className="hero-table" aria-hidden="true">
          <div className="hero-table-top">
            <GameController size={42} weight="duotone" />
            <Sparkle size={24} weight="fill" />
          </div>
          <GameController
            className="hero-table-visual"
            size={112}
            weight="duotone"
          />
          <div className="hero-table-caption">
            <UsersThree size={17} weight="bold" /> 私人房间 · 多轮对局
          </div>
        </div>
      </section>
      <section aria-labelledby="featured-games" className="home-games-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">即刻开局</p>
            <h2 id="featured-games">选择一款游戏</h2>
          </div>
          <Link className="text-link" href="/games">
            查看全部 <ArrowRight size={18} weight="bold" aria-hidden="true" />
          </Link>
        </div>
        <div className="catalog-grid">
          {gameCatalog.map((game) => (
            <article className="game-card clay-surface" key={game.id}>
              <div className="game-card-icon" aria-hidden="true">
                <GameController size={28} weight="duotone" />
              </div>
              <div className="game-card-meta">
                <span>
                  {game.minPlayers}–{game.maxPlayers} 位玩家
                </span>
                <span>回合制</span>
              </div>
              <h3>{game.title}</h3>
              <p>{game.description}</p>
              <Link className="card-link" href={`/games/${game.id}`}>
                进入游戏{" "}
                <ArrowRight size={18} weight="bold" aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
