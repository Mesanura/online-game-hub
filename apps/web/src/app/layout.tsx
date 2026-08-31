import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./styles.css";
import { SiteHeader } from "../components/site-header";

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
        <SiteHeader />
        <main>{children}</main>
      </body>
    </html>
  );
}
