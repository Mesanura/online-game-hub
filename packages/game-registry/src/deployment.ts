import type { SurfaceArtifactManifestV1 } from "@online-game-hub/game-surface-bridge";

import { gameCatalog } from "./catalog.js";

export type SetupProtocolGeneration = 5 | 6;

export type GamePresentationRegistration =
  | { readonly kind: "legacy-react" }
  | {
      readonly kind: "surface-v1";
      readonly publicBasePath: string;
      readonly artifact: SurfaceArtifactManifestV1;
    };

export interface GameDeploymentRegistration {
  readonly gameId: string;
  readonly gameVersion: string;
  readonly setupProtocol: SetupProtocolGeneration;
  readonly presentation: GamePresentationRegistration;
}

const legacy = (
  gameId: string,
  gameVersion: string,
): GameDeploymentRegistration =>
  Object.freeze({
    gameId,
    gameVersion,
    setupProtocol: 5,
    presentation: Object.freeze({ kind: "legacy-react" }),
  });

const gameDeployments = Object.freeze([
  legacy("tic-tac-toe", "1.0.0"),
  legacy("tic-tac-toe", "1.1.0"),
  legacy("connect-four", "1.0.0"),
  legacy("connect-four", "1.1.0"),
  legacy("gomoku", "1.0.0"),
  legacy("gomoku", "1.1.0"),
  legacy("hex", "1.0.0"),
  legacy("reversi", "1.0.0"),
  legacy("reversi", "1.1.0"),
  legacy("chinese-checkers", "1.0.0"),
  legacy("pong", "1.0.0"),
]) satisfies readonly GameDeploymentRegistration[];

export function resolveGameDeployment(
  gameId: string,
  gameVersion: string,
): GameDeploymentRegistration | undefined {
  return gameDeployments.find(
    (registration) =>
      registration.gameId === gameId &&
      registration.gameVersion === gameVersion,
  );
}

export function resolveCurrentGameDeployment(
  gameId: string,
): GameDeploymentRegistration | undefined {
  const manifest = gameCatalog.find((candidate) => candidate.id === gameId);
  return manifest === undefined
    ? undefined
    : resolveGameDeployment(manifest.id, manifest.gameVersion);
}
