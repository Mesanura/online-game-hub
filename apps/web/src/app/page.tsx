import Link from "next/link";

import { gameCatalog } from "@online-game-hub/game-registry/catalog";

export default function HomePage() {
  return (
    <div className="page-shell">
      <section className="hero">
        <p className="eyebrow">Server authoritative · Replay first</p>
        <h1>和朋友打开链接，就能开始一局。</h1>
        <p>
          匿名访客无需注册。创建私人房间，把不含任何凭据的邀请链接发给另一位玩家。
        </p>
        <Link className="primary-link" href="/games">
          浏览游戏
        </Link>
      </section>
      <section aria-labelledby="featured-games">
        <h2 id="featured-games">当前游戏</h2>
        <div className="catalog-grid">
          {gameCatalog.map((game) => (
            <article className="game-card" key={game.id}>
              <span>{game.minPlayers} 位玩家</span>
              <h3>{game.title}</h3>
              <p>{game.description}</p>
              <Link href={`/games/${game.id}`}>进入游戏</Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
