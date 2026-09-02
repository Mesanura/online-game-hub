"use client";

import { GameController, SquaresFour } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent } from "react";

import { ProfileMenu } from "./profile-menu";

export function SiteHeader() {
  const pathname = usePathname();
  const confirmIdentityChange = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      pathname.includes("/rooms/") &&
      !window.confirm(
        "账户操作会轮换当前身份。离开后将无法恢复本房间席位，是否继续？",
      )
    ) {
      event.preventDefault();
    }
  };
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
        <ProfileMenu confirmIdentityChange={confirmIdentityChange} />
      </nav>
    </header>
  );
}
