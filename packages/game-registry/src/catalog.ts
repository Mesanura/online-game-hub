import { connectFourManifest } from "@online-game-hub/connect-four/manifest";
import { chineseCheckersManifest } from "@online-game-hub/chinese-checkers/manifest";
import { gomokuManifest } from "@online-game-hub/gomoku/manifest";
import { hexManifest } from "@online-game-hub/hex/manifest";
import { reversiManifest } from "@online-game-hub/reversi/manifest";
import { ticTacToeManifest } from "@online-game-hub/tic-tac-toe/manifest";
import { pongManifest } from "@online-game-hub/pong/manifest";
// create-game:catalog-import
import type { GameManifest } from "@online-game-hub/game-sdk";
import type { RealtimeGameManifest } from "@online-game-hub/realtime-game-sdk";

export type CatalogGameManifest = GameManifest | RealtimeGameManifest;

export const gameCatalog = Object.freeze([
  ticTacToeManifest,
  connectFourManifest,
  gomokuManifest,
  hexManifest,
  reversiManifest,
  chineseCheckersManifest,
  pongManifest,
  // create-game:catalog-entry
]) satisfies readonly CatalogGameManifest[];

export function resolveGameManifest(
  gameId: string,
  gameVersion: string,
): CatalogGameManifest | undefined {
  return gameCatalog.find(
    (manifest) =>
      manifest.id === gameId && manifest.gameVersion === gameVersion,
  );
}

export function resolveCurrentGameManifest(
  gameId: string,
): CatalogGameManifest | undefined {
  return gameCatalog.find((manifest) => manifest.id === gameId);
}
