import { connectFourDefinition } from "@online-game-hub/connect-four/core";
import { gomokuDefinition } from "@online-game-hub/gomoku/core";
import { hexDefinition } from "@online-game-hub/hex/core";
import { reversiDefinition } from "@online-game-hub/reversi/core";
import { ticTacToeDefinition } from "@online-game-hub/tic-tac-toe/core";
// create-game:server-definition-import
import { eraseGameDefinition } from "@online-game-hub/game-sdk";
import type { UnknownGameDefinition } from "@online-game-hub/game-sdk";

const serverDefinitions = Object.freeze([
  eraseGameDefinition(ticTacToeDefinition),
  eraseGameDefinition(connectFourDefinition),
  eraseGameDefinition(gomokuDefinition),
  eraseGameDefinition(hexDefinition),
  eraseGameDefinition(reversiDefinition),
  // create-game:server-definition
]) as readonly UnknownGameDefinition[];

export function resolveGameDefinition(
  gameId: string,
  gameVersion: string,
): UnknownGameDefinition | undefined {
  return serverDefinitions.find(
    (definition) =>
      definition.manifest.id === gameId &&
      definition.manifest.gameVersion === gameVersion,
  );
}

export function resolveCurrentGameDefinition(
  gameId: string,
): UnknownGameDefinition | undefined {
  return serverDefinitions.find(
    (definition) => definition.manifest.id === gameId,
  );
}

export type GameDefinitionResolver = typeof resolveGameDefinition;
