import type {
  SurfaceArtifactManifestV1,
  SurfaceMode,
  SurfacePlatformControl,
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
  readonly platformControls: readonly SurfacePlatformControl[];
  readonly presentation: GamePresentationRegistration;
}

export interface ResolvedSurfaceEntrypoint {
  readonly gameId: string;
  readonly gameVersion: string;
  readonly surfaceVersion: string;
  readonly mode: SurfaceMode;
  readonly platformControls: readonly SurfacePlatformControl[];
  readonly url: string;
  readonly artifact: SurfaceArtifactManifestV1;
}

const noPlatformControls = Object.freeze(
  [],
) as readonly SurfacePlatformControl[];
const resignPlatformControls = Object.freeze([
  "RESIGN",
]) as readonly SurfacePlatformControl[];

const ticTacToeSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "tic-tac-toe",
  supportedGameVersions: ["1.0.0", "1.1.0"],
  surfaceVersion: "1.0.2",
  bridgeVersion: 1,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-QFZGspybmbozp51u4AhLgEDS+z7Zg9Q7Gb/xDz14ngg=",
} satisfies SurfaceArtifactManifestV1;

const ticTacToeSurface = (
  gameVersion: "1.0.0" | "1.1.0",
  setupProtocol: SetupProtocolGeneration,
): GameDeploymentRegistration =>
  Object.freeze({
    gameId: "tic-tac-toe",
    gameVersion,
    setupProtocol,
    platformControls:
      gameVersion === "1.1.0" ? resignPlatformControls : noPlatformControls,
    presentation: Object.freeze({
      kind: "surface-v1",
      publicBasePath: "/game-surfaces/tic-tac-toe/1.0.2",
      artifact: ticTacToeSurfaceArtifactV1,
    }),
  });

const pongSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "pong",
  supportedGameVersions: ["1.0.0"],
  surfaceVersion: "1.0.2",
  bridgeVersion: 1,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-URx8AUoXwzNe+/fEURQiZDA0aVGPNGElOtv3C3IaFes=",
} satisfies SurfaceArtifactManifestV1;

const pongSurfaceV1: GameDeploymentRegistration = Object.freeze({
  gameId: "pong",
  gameVersion: "1.0.0",
  setupProtocol: 6,
  platformControls: resignPlatformControls,
  presentation: Object.freeze({
    kind: "surface-v1",
    publicBasePath: "/game-surfaces/pong/1.0.2",
    artifact: pongSurfaceArtifactV1,
  }),
});

const connectFourSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "connect-four",
  supportedGameVersions: ["1.0.0", "1.1.0"],
  surfaceVersion: "1.0.1",
  bridgeVersion: 1,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-0UxerFl+aQvpxyQDduOpHbNURAJA2bk1QyHAwCnD4+k=",
} satisfies SurfaceArtifactManifestV1;

const connectFourSurface = (
  gameVersion: "1.0.0" | "1.1.0",
  setupProtocol: SetupProtocolGeneration,
): GameDeploymentRegistration =>
  Object.freeze({
    gameId: "connect-four",
    gameVersion,
    setupProtocol,
    platformControls:
      gameVersion === "1.1.0" ? resignPlatformControls : noPlatformControls,
    presentation: Object.freeze({
      kind: "surface-v1",
      publicBasePath: "/game-surfaces/connect-four/1.0.1",
      artifact: connectFourSurfaceArtifactV1,
    }),
  });

const gomokuSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "gomoku",
  supportedGameVersions: ["1.0.0", "1.1.0"],
  surfaceVersion: "1.0.1",
  bridgeVersion: 1,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-H7yYtvNZRo1o//RSd0Th/W86rrHu+V3lUFHccaipLfI=",
} satisfies SurfaceArtifactManifestV1;

const gomokuSurface = (
  gameVersion: "1.0.0" | "1.1.0",
  setupProtocol: SetupProtocolGeneration,
): GameDeploymentRegistration =>
  Object.freeze({
    gameId: "gomoku",
    gameVersion,
    setupProtocol,
    platformControls:
      gameVersion === "1.1.0" ? resignPlatformControls : noPlatformControls,
    presentation: Object.freeze({
      kind: "surface-v1",
      publicBasePath: "/game-surfaces/gomoku/1.0.1",
      artifact: gomokuSurfaceArtifactV1,
    }),
  });

const hexSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "hex",
  supportedGameVersions: ["1.0.0"],
  surfaceVersion: "1.0.1",
  bridgeVersion: 1,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-g/kmZr6MISYFMjj47GvcPv84PXb4n3X5IGmhJSYicxQ=",
} satisfies SurfaceArtifactManifestV1;

const hexSurfaceV1: GameDeploymentRegistration = Object.freeze({
  gameId: "hex",
  gameVersion: "1.0.0",
  setupProtocol: 6,
  platformControls: resignPlatformControls,
  presentation: Object.freeze({
    kind: "surface-v1",
    publicBasePath: "/game-surfaces/hex/1.0.1",
    artifact: hexSurfaceArtifactV1,
  }),
});

const reversiSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "reversi",
  supportedGameVersions: ["1.0.0", "1.1.0"],
  surfaceVersion: "1.0.1",
  bridgeVersion: 1,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-KYbiJGe9YV4JxOANhbMgbR/oBOWPKOqgjxu8VDhInwo=",
} satisfies SurfaceArtifactManifestV1;

const reversiSurface = (
  gameVersion: "1.0.0" | "1.1.0",
  setupProtocol: SetupProtocolGeneration,
): GameDeploymentRegistration =>
  Object.freeze({
    gameId: "reversi",
    gameVersion,
    setupProtocol,
    platformControls:
      gameVersion === "1.1.0" ? resignPlatformControls : noPlatformControls,
    presentation: Object.freeze({
      kind: "surface-v1",
      publicBasePath: "/game-surfaces/reversi/1.0.1",
      artifact: reversiSurfaceArtifactV1,
    }),
  });

const chineseCheckersSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "chinese-checkers",
  supportedGameVersions: ["1.0.0"],
  surfaceVersion: "1.0.1",
  bridgeVersion: 1,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-O+R4VWjzWVg12F+eaAzD/cIjnzCFRpyRnLCfyRaL4NU=",
} satisfies SurfaceArtifactManifestV1;

const chineseCheckersSurfaceV1: GameDeploymentRegistration = Object.freeze({
  gameId: "chinese-checkers",
  gameVersion: "1.0.0",
  setupProtocol: 6,
  platformControls: resignPlatformControls,
  presentation: Object.freeze({
    kind: "surface-v1",
    publicBasePath: "/game-surfaces/chinese-checkers/1.0.1",
    artifact: chineseCheckersSurfaceArtifactV1,
  }),
});

const gameDeployments = Object.freeze([
  ticTacToeSurface("1.0.0", 5),
  ticTacToeSurface("1.1.0", 6),
  connectFourSurface("1.0.0", 5),
  connectFourSurface("1.1.0", 6),
  gomokuSurface("1.0.0", 5),
  gomokuSurface("1.1.0", 6),
  hexSurfaceV1,
  reversiSurface("1.0.0", 5),
  reversiSurface("1.1.0", 6),
  chineseCheckersSurfaceV1,
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
    platformControls: registration.platformControls,
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
