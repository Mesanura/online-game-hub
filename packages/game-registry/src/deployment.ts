import type {
  SurfaceArtifactManifestV1,
  SurfaceMode,
} from "@online-game-hub/game-surface-bridge";

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

export interface ResolvedSurfaceEntrypoint {
  readonly gameId: string;
  readonly gameVersion: string;
  readonly surfaceVersion: string;
  readonly mode: SurfaceMode;
  readonly url: string;
  readonly artifact: SurfaceArtifactManifestV1;
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

const ticTacToeSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "tic-tac-toe",
  supportedGameVersions: ["1.1.0"],
  surfaceVersion: "1.0.0",
  bridgeVersion: 1,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-kP7B2210ENPCKROxkYKZde3AVYDOJpHtGtNx1QC6yow=",
} satisfies SurfaceArtifactManifestV1;

const ticTacToeSurfaceV1: GameDeploymentRegistration = Object.freeze({
  gameId: "tic-tac-toe",
  gameVersion: "1.1.0",
  setupProtocol: 6,
  presentation: Object.freeze({
    kind: "surface-v1",
    publicBasePath: "/game-surfaces/tic-tac-toe/1.0.0",
    artifact: ticTacToeSurfaceArtifactV1,
  }),
});

const gameDeployments = Object.freeze([
  legacy("tic-tac-toe", "1.0.0"),
  ticTacToeSurfaceV1,
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

export function resolveSurfaceEntrypoint(
  registration: GameDeploymentRegistration,
  mode: SurfaceMode,
): ResolvedSurfaceEntrypoint | undefined {
  if (registration.presentation.kind !== "surface-v1") return undefined;
  const { artifact, publicBasePath } = registration.presentation;
  if (!artifact.supportedGameVersions.includes(registration.gameVersion)) {
    return undefined;
  }
  const entrypoint = artifact.entrypoints[mode];
  if (entrypoint === undefined) return undefined;
  const basePath = publicBasePath.replace(/\/+$/u, "");
  if (basePath.length === 0) return undefined;
  return Object.freeze({
    gameId: registration.gameId,
    gameVersion: registration.gameVersion,
    surfaceVersion: artifact.surfaceVersion,
    mode,
    url: `${basePath}/${entrypoint}`,
    artifact,
  });
}

export function resolveGameSurfaceEntrypoint(
  gameId: string,
  gameVersion: string,
  mode: SurfaceMode,
): ResolvedSurfaceEntrypoint | undefined {
  const registration = resolveGameDeployment(gameId, gameVersion);
  return registration === undefined
    ? undefined
    : resolveSurfaceEntrypoint(registration, mode);
}
