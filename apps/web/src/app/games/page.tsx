"use client";

import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "@phosphor-icons/react";

import { GameCatalog } from "../../components/game-catalog";

export default function GamesPage() {
  return (
    <div className="page-shell catalog-page">
      <div className="catalog-heading">
        <div>
          <Link
            className="clay-button clay-button-secondary"
            data-testid="catalog-return-home"
            href="/"
          >
            <ArrowLeft size={18} weight="bold" aria-hidden="true" /> 返回首页
          </Link>
          <p className="eyebrow">游戏目录</p>
          <h1>选择一款游戏</h1>
          <p>从回合制棋类到实时对战，挑一款游戏，邀请朋友一起开局。</p>
        </div>
      </div>
      <Suspense fallback={<p role="status">加载游戏目录…</p>}>
        <GameCatalog />
      </Suspense>
    </div>
  );
}
