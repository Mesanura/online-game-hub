import { connectFourManifest } from "@online-game-hub/connect-four/manifest";
import { gomokuManifest } from "@online-game-hub/gomoku/manifest";
import { hexManifest } from "@online-game-hub/hex/manifest";
import { reversiManifest } from "@online-game-hub/reversi/manifest";
import { ticTacToeManifest } from "@online-game-hub/tic-tac-toe/manifest";
import type { GameManifest } from "@online-game-hub/game-sdk";

export const gameCatalog = Object.freeze([
  ticTacToeManifest,
  connectFourManifest,
  gomokuManifest,
  hexManifest,
  reversiManifest,
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
