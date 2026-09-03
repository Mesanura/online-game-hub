import {
  connectFourDefinition,
  connectFourDefinitionV1_0_0,
} from "@online-game-hub/connect-four/core";
import { chineseCheckersDefinition } from "@online-game-hub/chinese-checkers/core";
import {
  gomokuDefinition,
  gomokuDefinitionV1_0_0,
} from "@online-game-hub/gomoku/core";
import { hexDefinition } from "@online-game-hub/hex/core";
import {
  reversiDefinition,
  reversiDefinitionV1_0_0,
} from "@online-game-hub/reversi/core";
import {
  ticTacToeDefinition,
  ticTacToeDefinitionV1_0_0,
} from "@online-game-hub/tic-tac-toe/core";
import { pongDefinition } from "@online-game-hub/pong/core";
// create-game:server-definition-import
import { eraseGameDefinition } from "@online-game-hub/game-sdk";
import type { UnknownGameDefinition } from "@online-game-hub/game-sdk";
import { eraseRealtimeGameDefinition } from "@online-game-hub/realtime-game-sdk";
import type { UnknownRealtimeGameDefinition } from "@online-game-hub/realtime-game-sdk";

import { gameCatalog } from "./catalog.js";

const serverDefinitions = Object.freeze([
  eraseGameDefinition(ticTacToeDefinitionV1_0_0),
  eraseGameDefinition(ticTacToeDefinition),
  eraseGameDefinition(connectFourDefinitionV1_0_0),
  eraseGameDefinition(connectFourDefinition),
  eraseGameDefinition(gomokuDefinitionV1_0_0),
  eraseGameDefinition(gomokuDefinition),
  eraseGameDefinition(hexDefinition),
  eraseGameDefinition(reversiDefinitionV1_0_0),
  eraseGameDefinition(reversiDefinition),
  eraseGameDefinition(chineseCheckersDefinition),
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
  const manifest = gameCatalog.find((candidate) => candidate.id === gameId);
  return manifest === undefined || manifest.runtime !== "turn-based"
    ? undefined
    : resolveGameDefinition(manifest.id, manifest.gameVersion);
}

export type GameDefinitionResolver = typeof resolveGameDefinition;

const realtimeServerDefinitions = Object.freeze([
  eraseRealtimeGameDefinition(pongDefinition),
]) as readonly UnknownRealtimeGameDefinition[];

export function resolveRealtimeGameDefinition(
  gameId: string,
  gameVersion: string,
): UnknownRealtimeGameDefinition | undefined {
  return realtimeServerDefinitions.find(
    (definition) =>
      definition.manifest.id === gameId &&
      definition.manifest.gameVersion === gameVersion,
  );
}

export function resolveCurrentRealtimeGameDefinition(
  gameId: string,
): UnknownRealtimeGameDefinition | undefined {
  const manifest = gameCatalog.find((candidate) => candidate.id === gameId);
  return manifest === undefined || manifest.runtime !== "realtime"
    ? undefined
    : resolveRealtimeGameDefinition(manifest.id, manifest.gameVersion);
}

export type RealtimeGameDefinitionResolver =
  typeof resolveRealtimeGameDefinition;
