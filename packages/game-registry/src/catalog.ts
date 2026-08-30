import { connectFourManifest } from "@online-game-hub/connect-four/manifest";
import { ticTacToeManifest } from "@online-game-hub/tic-tac-toe/manifest";
import type { GameManifest } from "@online-game-hub/game-sdk";

export const gameCatalog = Object.freeze([
  ticTacToeManifest,
  connectFourManifest,
]) satisfies readonly GameManifest[];

export function resolveGameManifest(
  gameId: string,
  gameVersion: string,
): GameManifest | undefined {
  return gameCatalog.find(
    (manifest) =>
      manifest.id === gameId && manifest.gameVersion === gameVersion,
  );
}
