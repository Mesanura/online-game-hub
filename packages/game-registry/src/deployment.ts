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

const pongSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "pong",
  supportedGameVersions: ["1.0.0"],
  surfaceVersion: "1.0.1",
  bridgeVersion: 1,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-g2kTdu4LNPwONnh7iGDI37TVeHZce+nZzNf6N4yYtCY=",
} satisfies SurfaceArtifactManifestV1;

const pongSurfaceV1: GameDeploymentRegistration = Object.freeze({
  gameId: "pong",
  gameVersion: "1.0.0",
  setupProtocol: 6,
  presentation: Object.freeze({
    kind: "surface-v1",
    publicBasePath: "/game-surfaces/pong/1.0.1",
    artifact: pongSurfaceArtifactV1,
  }),
});

const connectFourSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "connect-four",
  supportedGameVersions: ["1.0.0", "1.1.0"],
  surfaceVersion: "1.0.0",
  bridgeVersion: 1,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-Ex09w9gaqUosnYdnuZcQhoq8QVWZ3bny8Q0oGD5JwdM=",
} satisfies SurfaceArtifactManifestV1;

const connectFourSurface = (
  gameVersion: "1.0.0" | "1.1.0",
  setupProtocol: SetupProtocolGeneration,
): GameDeploymentRegistration =>
  Object.freeze({
    gameId: "connect-four",
    gameVersion,
    setupProtocol,
    presentation: Object.freeze({
      kind: "surface-v1",
      publicBasePath: "/game-surfaces/connect-four/1.0.0",
      artifact: connectFourSurfaceArtifactV1,
    }),
  });

const gomokuSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "gomoku",
  supportedGameVersions: ["1.0.0", "1.1.0"],
  surfaceVersion: "1.0.0",
  bridgeVersion: 1,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-biPQnbE9J89ABY64swgwc9KgmHWTEhI1etrNnCUTROo=",
} satisfies SurfaceArtifactManifestV1;

const gomokuSurface = (
  gameVersion: "1.0.0" | "1.1.0",
  setupProtocol: SetupProtocolGeneration,
): GameDeploymentRegistration =>
  Object.freeze({
    gameId: "gomoku",
    gameVersion,
    setupProtocol,
    presentation: Object.freeze({
      kind: "surface-v1",
      publicBasePath: "/game-surfaces/gomoku/1.0.0",
      artifact: gomokuSurfaceArtifactV1,
    }),
  });

const gameDeployments = Object.freeze([
  legacy("tic-tac-toe", "1.0.0"),
  ticTacToeSurfaceV1,
  connectFourSurface("1.0.0", 5),
  connectFourSurface("1.1.0", 6),
  gomokuSurface("1.0.0", 5),
  gomokuSurface("1.1.0", 6),
  legacy("hex", "1.0.0"),
  legacy("reversi", "1.0.0"),
  legacy("reversi", "1.1.0"),
  legacy("chinese-checkers", "1.0.0"),
  pongSurfaceV1,
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
