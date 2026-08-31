import { notFound, redirect } from "next/navigation";

import { gameCatalog } from "@online-game-hub/game-registry/catalog";

import { GameRoomPage } from "../../../components/game-room-page";
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
  if (roomCode !== undefined && roomCode.trim().length > 0) {
    redirect(
      `/games/${encodeURIComponent(game.id)}/rooms/${encodeURIComponent(roomCode.trim().toUpperCase())}`,
    );
  }

  return (
    <GameRoomPage
      description={game.description}
      gameId={game.id}
      mode="entry"
      title={game.title}
    />
  );
}
