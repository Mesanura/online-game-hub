"use client";

import { GameController, SquaresFour } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function SiteHeader() {
  const pathname = usePathname();
  const [username, setUsername] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { account?: { username?: string } | null } | null) =>
        setUsername(payload?.account?.username ?? null),
      )
      .catch(() => setUsername(null));
  }, [pathname]);
  const confirmIdentityChange = (
    event: React.MouseEvent<HTMLAnchorElement>,
  ) => {
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
        {username === null ? (
          <>
            <Link
              className="header-nav-link"
              href="/login"
              onClick={confirmIdentityChange}
            >
              登录
            </Link>
            <Link
              className="header-nav-link"
              href="/register"
              onClick={confirmIdentityChange}
            >
              注册
            </Link>
          </>
        ) : (
          <Link
            className="header-nav-link"
            href="/account"
            onClick={confirmIdentityChange}
          >
            {username}
          </Link>
        )}
      </nav>
    </header>
  );
}
