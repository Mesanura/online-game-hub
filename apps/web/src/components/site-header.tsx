"use client";

import { GameController, SquaresFour } from "@phosphor-icons/react";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">
          <GameController size={22} weight="duotone" />
        </span>
        <span>Online Game Hub</span>
      </Link>
      <nav aria-label="主导航">
        <Link className="header-nav-link" href="/games">
          <SquaresFour size={18} weight="bold" aria-hidden="true" /> 游戏目录
        </Link>
      </nav>
    </header>
  );
}
