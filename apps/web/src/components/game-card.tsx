import Link from "next/link";
import { ArrowRight, GameController } from "@phosphor-icons/react";
import type { CatalogGameManifest } from "@online-game-hub/game-registry/catalog";

export function GameCard({
  game,
  variant,
}: {
  readonly game: CatalogGameManifest;
  readonly variant: "home" | "catalog";
}) {
  const Heading = variant === "home" ? "h3" : "h2";
  return (
    <article
      className={`game-card clay-surface${variant === "catalog" ? " catalog-card" : ""}`}
    >
      <div className="game-card-icon" aria-hidden="true">
        <GameController size={variant === "home" ? 28 : 32} weight="duotone" />
      </div>
      <div className="game-card-meta">
        <span>
          {game.minPlayers === game.maxPlayers
            ? game.minPlayers
            : `${game.minPlayers}–${game.maxPlayers}`}{" "}
          人
        </span>
        <span>{game.runtime === "realtime" ? "实时对战" : "回合制"}</span>
      </div>
      <Heading>{game.title}</Heading>
      <p>{game.description}</p>
      <Link className="card-link" href={`/games/${game.id}`}>
        {variant === "home" ? "进入游戏" : "创建或加入房间"}{" "}
        <ArrowRight size={18} weight="bold" aria-hidden="true" />
      </Link>
    </article>
  );
}
