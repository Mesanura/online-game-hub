import { notFound } from "next/navigation";

import { gameCatalog } from "@online-game-hub/game-registry/catalog";

import { GameRoomPage } from "../../../components/game-room-page";
import { getWebServerConfig } from "../../../server/runtime-config";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return gameCatalog.map((game) => ({ gameId: game.id }));
}

export default async function GamePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly gameId: string }>;
  readonly searchParams: Promise<{ readonly roomCode?: string | string[] }>;
}) {
  const { gameId } = await params;
  const game = gameCatalog.find((candidate) => candidate.id === gameId);
  if (game === undefined) notFound();
  const query = await searchParams;
  const roomCode =
    typeof query.roomCode === "string" ? query.roomCode : undefined;
  const config = getWebServerConfig();

  return (
    <GameRoomPage
      gameId={game.id}
      gameServerUrl={config.gameServerPublicUrl}
      initialConfig={null}
      initialRoomCode={roomCode}
      title={game.title}
    />
  );
}
