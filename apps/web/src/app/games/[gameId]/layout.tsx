import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { gameCatalog } from "@online-game-hub/game-registry/catalog";

import { GameRoomHostProvider } from "../../../components/game-room-host";
import { getWebServerConfig } from "../../../server/runtime-config";

export const dynamic = "force-dynamic";

export default async function GameLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly gameId: string }>;
}) {
  const { gameId } = await params;
  const game = gameCatalog.find((candidate) => candidate.id === gameId);
  if (game === undefined) notFound();
  const config = getWebServerConfig();
  return (
    <GameRoomHostProvider
      gameId={game.id}
      gameServerUrl={config.gameServerPublicUrl}
      initialConfig={game.defaultConfig}
    >
      {children}
    </GameRoomHostProvider>
  );
}
