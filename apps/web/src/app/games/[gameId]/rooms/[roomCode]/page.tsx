import { notFound } from "next/navigation";

import { gameCatalog } from "@online-game-hub/game-registry/catalog";

import { GameRoomPage } from "../../../../../components/game-room-page";

export default async function RoomPage({
  params,
}: {
  readonly params: Promise<{
    readonly gameId: string;
    readonly roomCode: string;
  }>;
}) {
  const { gameId } = await params;
  const game = gameCatalog.find((candidate) => candidate.id === gameId);
  if (game === undefined) notFound();
  return (
    <GameRoomPage
      description={game.description}
      gameId={game.id}
      mode="room"
      title={game.title}
    />
  );
}
