import {
  connectFourDefinition,
  connectFourDefinitionV1_0_0,
} from "@online-game-hub/connect-four/core";
import { connectFourSetupDefinition } from "@online-game-hub/connect-four/setup";
import { chineseCheckersDefinition } from "@online-game-hub/chinese-checkers/core";
import {
  gomokuDefinition,
  gomokuDefinitionV1_0_0,
} from "@online-game-hub/gomoku/core";
import { gomokuSetupDefinition } from "@online-game-hub/gomoku/setup";
import { hexDefinition } from "@online-game-hub/hex/core";
import {
  reversiDefinition,
  reversiDefinitionV1_0_0,
} from "@online-game-hub/reversi/core";
import { reversiSetupDefinition } from "@online-game-hub/reversi/setup";
import {
  ticTacToeDefinition,
  ticTacToeDefinitionV1_0_0,
} from "@online-game-hub/tic-tac-toe/core";
import { ticTacToeSetupDefinition } from "@online-game-hub/tic-tac-toe/setup";
import { pongDefinition } from "@online-game-hub/pong/core";
import { pongSetupDefinition } from "@online-game-hub/pong/setup";
// create-game:server-definition-import
import { eraseGameDefinition } from "@online-game-hub/game-sdk";
import type { UnknownGameDefinition } from "@online-game-hub/game-sdk";
import {
  eraseRoundSetupDefinition,
  type UnknownRoundSetupDefinition,
} from "@online-game-hub/game-setup";
import { eraseRealtimeGameDefinition } from "@online-game-hub/realtime-game-sdk";
import type { UnknownRealtimeGameDefinition } from "@online-game-hub/realtime-game-sdk";

import { resolveCurrentGameManifest } from "./catalog.js";

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
  const manifest = resolveCurrentGameManifest(gameId);
  return manifest === undefined ||
    manifest.runtime !== "turn-based" ||
    manifest.capabilities.replay === "none"
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
  const manifest = resolveCurrentGameManifest(gameId);
  return manifest === undefined ||
    manifest.runtime !== "realtime" ||
    manifest.capabilities.replay === "none"
    ? undefined
    : resolveRealtimeGameDefinition(manifest.id, manifest.gameVersion);
}

export type RealtimeGameDefinitionResolver =
  typeof resolveRealtimeGameDefinition;

const roundSetupDefinitions = Object.freeze([
  Object.freeze({
    gameId: ticTacToeDefinition.manifest.id,
    gameVersion: ticTacToeDefinition.manifest.gameVersion,
    definition: eraseRoundSetupDefinition(ticTacToeSetupDefinition),
  }),
  Object.freeze({
    gameId: pongDefinition.manifest.id,
    gameVersion: pongDefinition.manifest.gameVersion,
    definition: eraseRoundSetupDefinition(pongSetupDefinition),
  }),
  Object.freeze({
    gameId: connectFourDefinition.manifest.id,
    gameVersion: connectFourDefinition.manifest.gameVersion,
    definition: eraseRoundSetupDefinition(connectFourSetupDefinition),
  }),
  Object.freeze({
    gameId: gomokuDefinition.manifest.id,
    gameVersion: gomokuDefinition.manifest.gameVersion,
    definition: eraseRoundSetupDefinition(gomokuSetupDefinition),
  }),
  Object.freeze({
    gameId: reversiDefinition.manifest.id,
    gameVersion: reversiDefinition.manifest.gameVersion,
    definition: eraseRoundSetupDefinition(reversiSetupDefinition),
  }),
]);

export function resolveRoundSetupDefinition(
  gameId: string,
  gameVersion: string,
): UnknownRoundSetupDefinition | undefined {
  return roundSetupDefinitions.find(
    (registration) =>
      registration.gameId === gameId &&
      registration.gameVersion === gameVersion,
  )?.definition;
}

export function resolveCurrentRoundSetupDefinition(
  gameId: string,
): UnknownRoundSetupDefinition | undefined {
  const manifest = resolveCurrentGameManifest(gameId);
  return manifest === undefined
    ? undefined
    : resolveRoundSetupDefinition(manifest.id, manifest.gameVersion);
}

export type RoundSetupDefinitionResolver = typeof resolveRoundSetupDefinition;
