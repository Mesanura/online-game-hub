import Link from "next/link";

import { gameCatalog } from "@online-game-hub/game-registry/catalog";

export default function GamesPage() {
  return (
    <div className="page-shell">
      <p className="eyebrow">游戏目录</p>
      <h1>选择一款游戏</h1>
      <div className="catalog-grid">
        {gameCatalog.map((game) => (
          <article className="game-card" key={game.id}>
            <h2>{game.title}</h2>
            <p>{game.description}</p>
            <dl>
              <div>
                <dt>人数</dt>
                <dd>
                  {game.minPlayers}–{game.maxPlayers}
                </dd>
              </div>
              <div>
                <dt>模式</dt>
                <dd>回合制</dd>
              </div>
            </dl>
            <Link href={`/games/${game.id}`}>创建或加入房间</Link>
          </article>
        ))}
      </div>
    </div>
  );
}
