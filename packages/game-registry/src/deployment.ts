import type {
  SurfaceArtifactManifestV1,
  SurfaceMode,
  SurfacePlatformControl,
} from "@online-game-hub/game-surface-bridge";

import { gameCatalog } from "./catalog.js";

export type SetupProtocolGeneration = 6;

export interface GamePresentationRegistration {
  readonly kind: "surface-v1";
  readonly publicBasePath: string;
  readonly artifact: SurfaceArtifactManifestV1;
}

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
  surfaceVersion: "1.0.4",
  bridgeVersion: 2,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-LDNiF0tIsX/E/ltr8/e4b3lbtEHGD74KplDZamHiaUY=",
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
      publicBasePath: "/game-surfaces/tic-tac-toe/1.0.4",
      artifact: ticTacToeSurfaceArtifactV1,
    }),
  });

const pongSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "pong",
  supportedGameVersions: ["1.0.0", "1.1.0", "1.2.0"],
  surfaceVersion: "1.2.2",
  bridgeVersion: 2,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-9Vwhq1f8/tH5Njk5/+8W0C5QHBU7pO9LyOLuq2i3EDk=",
} satisfies SurfaceArtifactManifestV1;

const pongSurface = (
  gameVersion: "1.0.0" | "1.1.0" | "1.2.0",
): GameDeploymentRegistration =>
  Object.freeze({
    gameId: "pong",
    gameVersion,
    setupProtocol: 6,
    platformControls: resignPlatformControls,
    presentation: Object.freeze({
      kind: "surface-v1",
      publicBasePath: "/game-surfaces/pong/1.2.2",
      artifact: pongSurfaceArtifactV1,
    }),
  });

const connectFourSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "connect-four",
  supportedGameVersions: ["1.0.0", "1.1.0"],
  surfaceVersion: "1.0.5",
  bridgeVersion: 2,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-fQmmobZNselpWyiV8WVHY3077RzFv3OoCn7WP1LBjBc=",
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
      publicBasePath: "/game-surfaces/connect-four/1.0.5",
      artifact: connectFourSurfaceArtifactV1,
    }),
  });

const gomokuSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "gomoku",
  supportedGameVersions: ["1.0.0", "1.1.0"],
  surfaceVersion: "1.0.4",
  bridgeVersion: 2,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-OZX0VTjFnX/1iAYBysAU3Gn10+gF/qJ0y/8VUGcce6M=",
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
      publicBasePath: "/game-surfaces/gomoku/1.0.4",
      artifact: gomokuSurfaceArtifactV1,
    }),
  });

const hexSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "hex",
  supportedGameVersions: ["1.0.0"],
  surfaceVersion: "1.0.3",
  bridgeVersion: 2,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-d8uH4c1RVPBLFQGLsn8V5m0/+4n7tlKHykiZ3sXhMGY=",
} satisfies SurfaceArtifactManifestV1;

const hexSurfaceV1: GameDeploymentRegistration = Object.freeze({
  gameId: "hex",
  gameVersion: "1.0.0",
  setupProtocol: 6,
  platformControls: resignPlatformControls,
  presentation: Object.freeze({
    kind: "surface-v1",
    publicBasePath: "/game-surfaces/hex/1.0.3",
    artifact: hexSurfaceArtifactV1,
  }),
});

const reversiSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "reversi",
  supportedGameVersions: ["1.0.0", "1.1.0"],
  surfaceVersion: "1.0.5",
  bridgeVersion: 2,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-jTTVeQvsd5G1jZHa2PpYHy1lE5na+eEuqIGns6x9RW8=",
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
      publicBasePath: "/game-surfaces/reversi/1.0.5",
      artifact: reversiSurfaceArtifactV1,
    }),
  });

const chineseCheckersSurfaceArtifactV1 = {
  schemaVersion: 1,
  gameId: "chinese-checkers",
  supportedGameVersions: ["1.0.0", "1.1.0"],
  surfaceVersion: "1.1.2",
  bridgeVersion: 2,
  entrypoints: {
    setup: "setup/index.html",
    play: "play/index.html",
    replay: "replay/index.html",
  },
  capabilities: {},
  contentDigest: "sha256-62jydJV17R+HBPZwM8BEfSwRTVp1WaC4ImxtI05nfhg=",
} satisfies SurfaceArtifactManifestV1;

const chineseCheckersSurface = (
  gameVersion: "1.0.0" | "1.1.0",
): GameDeploymentRegistration =>
  Object.freeze({
    gameId: "chinese-checkers",
    gameVersion,
    setupProtocol: 6,
    platformControls: resignPlatformControls,
    presentation: Object.freeze({
      kind: "surface-v1",
      publicBasePath: "/game-surfaces/chinese-checkers/1.1.2",
      artifact: chineseCheckersSurfaceArtifactV1,
    }),
  });

const badmintonSurface = (
  gameVersion: "1.0.0" | "1.1.0" | "1.2.0" | "1.3.0" | "1.4.0" | "1.5.0",
): GameDeploymentRegistration =>
  Object.freeze({
    gameId: "badminton",
    gameVersion,
    setupProtocol: 6,
    platformControls: resignPlatformControls,
    presentation: Object.freeze({
      kind: "surface-v1",
      publicBasePath: "/game-surfaces/badminton/1.4.0",
      artifact: {
        schemaVersion: 1,
        gameId: "badminton",
        supportedGameVersions: ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0"],
        surfaceVersion: "1.4.0",
        bridgeVersion: 2,
        entrypoints: { setup: "setup/index.html", play: "play/index.html" },
        capabilities: {},
        contentDigest: "sha256-PXcLn/PoNHzi18tbGOAZ/zWbQsKr/vNpo+8agnYZuAo=",
      } satisfies SurfaceArtifactManifestV1,
    }),
  });

const tankMazeSurface = (gameVersion: "1.0.0" | "1.1.0" | "1.2.0" | "1.3.0") =>
  ({
    gameId: "tank-maze",
    gameVersion,
    setupProtocol: 6,
    platformControls: resignPlatformControls,
    presentation: {
      kind: "surface-v1",
      publicBasePath: "/game-surfaces/tank-maze/1.2.0",
      artifact: {
        schemaVersion: 1,
        gameId: "tank-maze",
        supportedGameVersions: ["1.0.0", "1.1.0", "1.2.0", "1.3.0"],
        surfaceVersion: "1.2.0",
        bridgeVersion: 2,
        entrypoints: { setup: "setup/index.html", play: "play/index.html" },
        capabilities: {},
        contentDigest: "sha256-SxbEoeDkhZ0+lehfxctkqMdCq7k6cudoigxtsDc2sKI=",
      },
    },
  }) as const satisfies GameDeploymentRegistration;

const airHockeySurface = (
  gameVersion: "1.0.0" | "1.1.0",
): GameDeploymentRegistration =>
  Object.freeze({
    gameId: "air-hockey",
    gameVersion,
    setupProtocol: 6,
    platformControls: resignPlatformControls,
    presentation: Object.freeze({
      kind: "surface-v1",
      publicBasePath: "/game-surfaces/air-hockey/1.0.2",
      artifact: {
        schemaVersion: 1,
        gameId: "air-hockey",
        supportedGameVersions: ["1.0.0", "1.1.0"],
        surfaceVersion: "1.0.2",
        bridgeVersion: 2,
        entrypoints: { setup: "setup/index.html", play: "play/index.html" },
        capabilities: {},
        contentDigest: "sha256-4ymWzahEKcpx1ph7MvcP9JfZROImr1Fa78foBtR3VUs=",
      } satisfies SurfaceArtifactManifestV1,
    }),
  });

const bombermanSurface = (
  gameVersion: "1.0.0" | "1.1.0" | "1.2.0",
): GameDeploymentRegistration =>
  Object.freeze({
    gameId: "bomberman",
    gameVersion,
    setupProtocol: 6,
    platformControls: resignPlatformControls,
    presentation: Object.freeze({
      kind: "surface-v1",
      publicBasePath: "/game-surfaces/bomberman/1.2.0",
      artifact: {
        schemaVersion: 1,
        gameId: "bomberman",
        supportedGameVersions: ["1.0.0", "1.1.0", "1.2.0"],
        surfaceVersion: "1.2.0",
        bridgeVersion: 2,
        entrypoints: { setup: "setup/index.html", play: "play/index.html" },
        capabilities: {},
        contentDigest: "sha256-4W2B5zD4Ldk89fl72Kt+tHlmx9rrnMHSzu2mNRK40bk=",
      } satisfies SurfaceArtifactManifestV1,
    }),
  });

const ninjaClashSurface = (gameVersion: "1.0.0" | "1.1.0") =>
  ({
    gameId: "ninja-clash",
    gameVersion,
    setupProtocol: 6,
    platformControls: resignPlatformControls,
    presentation: {
      kind: "surface-v1",
      publicBasePath: "/game-surfaces/ninja-clash/1.1.0",
      artifact: {
        schemaVersion: 1,
        gameId: "ninja-clash",
        supportedGameVersions: ["1.0.0", "1.1.0"],
        surfaceVersion: "1.1.0",
        bridgeVersion: 2,
        entrypoints: { setup: "setup/index.html", play: "play/index.html" },
        capabilities: {},
        contentDigest: "sha256-enVGWBZP+PJTIHGT50AWfsDnCUxz1usExDPU88MizpU=",
      },
    },
  }) as const satisfies GameDeploymentRegistration;
const gameDeployments = Object.freeze([
  ninjaClashSurface("1.0.0"),
  ninjaClashSurface("1.1.0"),
  bombermanSurface("1.0.0"),
  bombermanSurface("1.1.0"),
  bombermanSurface("1.2.0"),
  airHockeySurface("1.0.0"),
  airHockeySurface("1.1.0"),
  tankMazeSurface("1.0.0"),
  tankMazeSurface("1.1.0"),
  tankMazeSurface("1.2.0"),
  tankMazeSurface("1.3.0"),
  ticTacToeSurface("1.0.0", 6),
  ticTacToeSurface("1.1.0", 6),
  connectFourSurface("1.0.0", 6),
  connectFourSurface("1.1.0", 6),
  gomokuSurface("1.0.0", 6),
  gomokuSurface("1.1.0", 6),
  hexSurfaceV1,
  reversiSurface("1.0.0", 6),
  reversiSurface("1.1.0", 6),
  chineseCheckersSurface("1.0.0"),
  chineseCheckersSurface("1.1.0"),
  pongSurface("1.0.0"),
  pongSurface("1.1.0"),
  pongSurface("1.2.0"),
  badmintonSurface("1.0.0"),
  badmintonSurface("1.1.0"),
  badmintonSurface("1.2.0"),
  badmintonSurface("1.3.0"),
  badmintonSurface("1.4.0"),
  badmintonSurface("1.5.0"),
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
