import { ticTacToeDefinition } from "@online-game-hub/tic-tac-toe/core";
import { eraseGameDefinition } from "@online-game-hub/game-sdk";
import type { UnknownGameDefinition } from "@online-game-hub/game-sdk";

const serverDefinitions = Object.freeze([
  eraseGameDefinition(ticTacToeDefinition),
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

export type GameDefinitionResolver = typeof resolveGameDefinition;
