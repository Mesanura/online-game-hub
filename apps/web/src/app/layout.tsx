import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./styles.css";

export const metadata: Metadata = {
  title: "Online Game Hub",
  description: "Server-authoritative multiplayer games in the browser.",
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="zh-Hans">
      <body>
        <header className="site-header">
          <Link className="brand" href="/">
            Online Game Hub
          </Link>
          <nav aria-label="主导航">
            <Link href="/games">游戏目录</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
