import { describe, expect, it } from "vitest";

import { gameCatalog, resolveGameManifest } from "../src/catalog.js";
import {
  resolveCurrentGameDeployment,
  resolveGameDeployment,
  resolveGameSurfaceEntrypoint,
  resolveSurfaceEntrypoint,
  type GameDeploymentRegistration,
} from "../src/deployment.js";
import {
  resolveCurrentGameDefinition,
  resolveCurrentRoundSetupDefinition,
  resolveCurrentRealtimeGameDefinition,
  resolveGameDefinition,
  resolveRealtimeGameDefinition,
  resolveRoundSetupDefinition,
} from "../src/server.js";

describe("explicit game registry", () => {
  it("uses each game's single manifest source in the catalog and server", () => {
    expect(Object.isFrozen(gameCatalog)).toBe(true);
    expect(gameCatalog).not.toHaveLength(0);
    expect(
      gameCatalog.slice(0, 5).map(({ id, title, gameVersion }) => ({
        id,
        title,
        gameVersion,
      })),
    ).toEqual([
      { id: "tic-tac-toe", title: "井字棋", gameVersion: "1.1.0" },
      { id: "connect-four", title: "四子棋", gameVersion: "1.1.0" },
      { id: "gomoku", title: "五子棋", gameVersion: "1.1.0" },
      { id: "hex", title: "六贯棋", gameVersion: "1.0.0" },
      { id: "reversi", title: "黑白棋", gameVersion: "1.1.0" },
    ]);
    expect(new Set(gameCatalog.map(({ id }) => id)).size).toBe(
      gameCatalog.length,
    );

    for (const manifest of gameCatalog) {
      expect(manifest.capabilities.replay).toBe(
        ["pong", "badminton", "tank-maze"].includes(manifest.id)
          ? "record-only"
          : "player-playback",
      );
      expect(resolveGameManifest(manifest.id, manifest.gameVersion)).toBe(
        manifest,
      );
      const definition =
        manifest.runtime === "turn-based"
          ? resolveGameDefinition(manifest.id, manifest.gameVersion)
          : resolveRealtimeGameDefinition(manifest.id, manifest.gameVersion);
      expect(definition?.manifest).toBe(manifest);
      expect(definition?.configSchema.parse(manifest.defaultConfig)).toEqual(
        manifest.defaultConfig,
      );
      expect(
        resolveGameDeployment(manifest.id, manifest.gameVersion),
      ).toMatchObject({
        gameId: manifest.id,
        gameVersion: manifest.gameVersion,
        setupProtocol: 6,
        presentation: { kind: "surface-v1" },
      });
      const currentDeployment = resolveCurrentGameDeployment(manifest.id);
      expect(currentDeployment).toEqual(
        resolveGameDeployment(manifest.id, manifest.gameVersion),
      );
      expect(currentDeployment?.platformControls).toEqual(["RESIGN"]);
    }
  });

  it("resolves only exact gameId + gameVersion", () => {
    expect(resolveGameDefinition("unknown", "1.0.0")).toBeUndefined();
    expect(resolveGameManifest("unknown", "1.0.0")).toBeUndefined();
    expect(
      resolveGameSurfaceEntrypoint("unknown", "1.0.0", "play"),
    ).toBeUndefined();

    for (const manifest of gameCatalog) {
      expect(
        manifest.runtime === "turn-based"
          ? resolveGameDefinition(
              manifest.id,
              `${manifest.gameVersion}-unknown`,
            )
          : resolveRealtimeGameDefinition(
              manifest.id,
              `${manifest.gameVersion}-unknown`,
            ),
      ).toBeUndefined();
      expect(
        resolveGameManifest(manifest.id, `${manifest.gameVersion}-unknown`),
      ).toBeUndefined();
      expect(
        resolveGameSurfaceEntrypoint(
          manifest.id,
          `${manifest.gameVersion}-unknown`,
          "replay",
        ),
      ).toBeUndefined();
    }
  });

  it("resolves Surface artifacts by exact game, version and mode", () => {
    const registration: GameDeploymentRegistration = {
      gameId: "fixture-game",
      gameVersion: "1.0.0",
      setupProtocol: 6,
      platformControls: [],
      presentation: {
        kind: "surface-v1",
        publicBasePath: "/game-surfaces/fixture-game/2.0.0/",
        artifact: {
          schemaVersion: 1,
          gameId: "fixture-game",
          supportedGameVersions: ["1.0.0"],
          surfaceVersion: "2.0.0",
          bridgeVersion: 1,
          entrypoints: {
            setup: "setup/index.html",
            play: "play/index.html",
          },
          capabilities: {},
          contentDigest: `sha256-${"A".repeat(43)}=`,
        },
      },
    };

    expect(resolveSurfaceEntrypoint(registration, "setup")).toMatchObject({
      gameId: "fixture-game",
      gameVersion: "1.0.0",
      surfaceVersion: "2.0.0",
      mode: "setup",
      platformControls: [],
      url: "/game-surfaces/fixture-game/2.0.0/setup/index.html",
    });
    expect(resolveSurfaceEntrypoint(registration, "replay")).toBeUndefined();
    expect(
      resolveSurfaceEntrypoint(
        { ...registration, gameVersion: "1.1.0" },
        "play",
      ),
    ).toBeUndefined();
    for (const gameVersion of ["1.0.0", "1.1.0"] as const) {
      expect(resolveGameDeployment("tic-tac-toe", gameVersion)).toMatchObject({
        setupProtocol: 6,
        presentation: {
          kind: "surface-v1",
          publicBasePath: "/game-surfaces/tic-tac-toe/1.0.4",
          artifact: {
            supportedGameVersions: ["1.0.0", "1.1.0"],
            surfaceVersion: "1.0.4",
            contentDigest:
              "sha256-LDNiF0tIsX/E/ltr8/e4b3lbtEHGD74KplDZamHiaUY=",
          },
        },
        platformControls: gameVersion === "1.1.0" ? ["RESIGN"] : [],
      });
      for (const mode of ["setup", "play", "replay"] as const) {
        expect(
          resolveGameSurfaceEntrypoint("tic-tac-toe", gameVersion, mode),
        ).toMatchObject({
          gameId: "tic-tac-toe",
          gameVersion,
          surfaceVersion: "1.0.4",
          mode,
          platformControls: gameVersion === "1.1.0" ? ["RESIGN"] : [],
          url: `/game-surfaces/tic-tac-toe/1.0.4/${mode}/index.html`,
        });
      }
    }
    for (const gameVersion of ["1.0.0", "1.1.0", "1.2.0"] as const) {
      expect(resolveGameDeployment("pong", gameVersion)).toMatchObject({
        setupProtocol: 6,
        presentation: {
          kind: "surface-v1",
          publicBasePath: "/game-surfaces/pong/1.2.1",
          artifact: {
            supportedGameVersions: ["1.0.0", "1.1.0", "1.2.0"],
            surfaceVersion: "1.2.1",
            contentDigest:
              "sha256-H+wHnMaAHzvWLk+ylqufNnkxfVQTwifG7Jb4Jvab61o=",
          },
        },
        platformControls: ["RESIGN"],
      });
      for (const mode of ["setup", "play"] as const) {
        expect(
          resolveGameSurfaceEntrypoint("pong", gameVersion, mode),
        ).toMatchObject({
          gameId: "pong",
          gameVersion,
          surfaceVersion: "1.2.1",
          mode,
          platformControls: ["RESIGN"],
          url: `/game-surfaces/pong/1.2.1/${mode}/index.html`,
        });
      }
      expect(
        resolveGameSurfaceEntrypoint("pong", gameVersion, "replay"),
      ).toBeUndefined();
    }
    for (const gameVersion of ["1.0.0", "1.1.0"] as const) {
      expect(resolveGameDeployment("connect-four", gameVersion)).toMatchObject({
        setupProtocol: 6,
        presentation: {
          kind: "surface-v1",
          publicBasePath: "/game-surfaces/connect-four/1.0.5",
          artifact: {
            supportedGameVersions: ["1.0.0", "1.1.0"],
            surfaceVersion: "1.0.5",
            contentDigest:
              "sha256-fQmmobZNselpWyiV8WVHY3077RzFv3OoCn7WP1LBjBc=",
          },
        },
        platformControls: gameVersion === "1.1.0" ? ["RESIGN"] : [],
      });
      for (const mode of ["setup", "play", "replay"] as const) {
        expect(
          resolveGameSurfaceEntrypoint("connect-four", gameVersion, mode),
        ).toMatchObject({
          gameId: "connect-four",
          gameVersion,
          surfaceVersion: "1.0.5",
          mode,
          platformControls: gameVersion === "1.1.0" ? ["RESIGN"] : [],
          url: `/game-surfaces/connect-four/1.0.5/${mode}/index.html`,
        });
      }
    }
    for (const gameVersion of ["1.0.0", "1.1.0"] as const) {
      expect(
        resolveGameDeployment("chinese-checkers", gameVersion),
      ).toMatchObject({
        setupProtocol: 6,
        presentation: {
          kind: "surface-v1",
          publicBasePath: "/game-surfaces/chinese-checkers/1.1.2",
          artifact: {
            supportedGameVersions: ["1.0.0", "1.1.0"],
            surfaceVersion: "1.1.2",
            contentDigest:
              "sha256-62jydJV17R+HBPZwM8BEfSwRTVp1WaC4ImxtI05nfhg=",
          },
        },
        platformControls: ["RESIGN"],
      });
      for (const mode of ["setup", "play", "replay"] as const) {
        expect(
          resolveGameSurfaceEntrypoint("chinese-checkers", gameVersion, mode),
        ).toMatchObject({
          gameId: "chinese-checkers",
          gameVersion,
          surfaceVersion: "1.1.2",
          mode,
          platformControls: ["RESIGN"],
          url: `/game-surfaces/chinese-checkers/1.1.2/${mode}/index.html`,
        });
      }
    }
    for (const gameVersion of ["1.0.0", "1.1.0"] as const) {
      expect(resolveGameDeployment("gomoku", gameVersion)).toMatchObject({
        setupProtocol: 6,
        presentation: {
          kind: "surface-v1",
          publicBasePath: "/game-surfaces/gomoku/1.0.4",
          artifact: {
            supportedGameVersions: ["1.0.0", "1.1.0"],
            surfaceVersion: "1.0.4",
            contentDigest:
              "sha256-OZX0VTjFnX/1iAYBysAU3Gn10+gF/qJ0y/8VUGcce6M=",
          },
        },
        platformControls: gameVersion === "1.1.0" ? ["RESIGN"] : [],
      });
      for (const mode of ["setup", "play", "replay"] as const) {
        expect(
          resolveGameSurfaceEntrypoint("gomoku", gameVersion, mode),
        ).toMatchObject({
          gameId: "gomoku",
          gameVersion,
          surfaceVersion: "1.0.4",
          mode,
          platformControls: gameVersion === "1.1.0" ? ["RESIGN"] : [],
          url: `/game-surfaces/gomoku/1.0.4/${mode}/index.html`,
        });
      }
    }
    expect(resolveGameDeployment("hex", "1.0.0")).toMatchObject({
      setupProtocol: 6,
      presentation: {
        kind: "surface-v1",
        publicBasePath: "/game-surfaces/hex/1.0.3",
        artifact: {
          supportedGameVersions: ["1.0.0"],
          surfaceVersion: "1.0.3",
          contentDigest: "sha256-d8uH4c1RVPBLFQGLsn8V5m0/+4n7tlKHykiZ3sXhMGY=",
        },
      },
      platformControls: ["RESIGN"],
    });
    for (const mode of ["setup", "play", "replay"] as const) {
      expect(resolveGameSurfaceEntrypoint("hex", "1.0.0", mode)).toMatchObject({
        gameId: "hex",
        gameVersion: "1.0.0",
        surfaceVersion: "1.0.3",
        mode,
        platformControls: ["RESIGN"],
        url: `/game-surfaces/hex/1.0.3/${mode}/index.html`,
      });
    }
    for (const gameVersion of ["1.0.0", "1.1.0"] as const) {
      expect(resolveGameDeployment("reversi", gameVersion)).toMatchObject({
        setupProtocol: 6,
        presentation: {
          kind: "surface-v1",
          publicBasePath: "/game-surfaces/reversi/1.0.5",
          artifact: {
            supportedGameVersions: ["1.0.0", "1.1.0"],
            surfaceVersion: "1.0.5",
            contentDigest:
              "sha256-jTTVeQvsd5G1jZHa2PpYHy1lE5na+eEuqIGns6x9RW8=",
          },
        },
        platformControls: gameVersion === "1.1.0" ? ["RESIGN"] : [],
      });
      for (const mode of ["setup", "play", "replay"] as const) {
        expect(
          resolveGameSurfaceEntrypoint("reversi", gameVersion, mode),
        ).toMatchObject({
          gameId: "reversi",
          gameVersion,
          surfaceVersion: "1.0.5",
          mode,
          platformControls: gameVersion === "1.1.0" ? ["RESIGN"] : [],
          url: `/game-surfaces/reversi/1.0.5/${mode}/index.html`,
        });
      }
    }
  });

  it("selects each explicitly registered current definition for new rooms", () => {
    for (const manifest of gameCatalog) {
      if (manifest.runtime === "turn-based") {
        expect(resolveCurrentGameDefinition(manifest.id)).toBe(
          resolveGameDefinition(manifest.id, manifest.gameVersion),
        );
        expect(
          resolveCurrentRealtimeGameDefinition(manifest.id),
        ).toBeUndefined();
      } else {
        expect(resolveCurrentRealtimeGameDefinition(manifest.id)).toBe(
          resolveRealtimeGameDefinition(manifest.id, manifest.gameVersion),
        );
        expect(resolveCurrentGameDefinition(manifest.id)).toBeUndefined();
      }
    }
    expect(resolveCurrentGameDefinition("unknown")).toBeUndefined();
  });

  it("resolves game-owned Setup definitions only by exact registered version", () => {
    for (const [gameId, gameVersion] of [
      ["tic-tac-toe", "1.0.0"],
      ["tic-tac-toe", "1.1.0"],
      ["pong", "1.0.0"],
      ["pong", "1.1.0"],
      ["pong", "1.2.0"],
      ["badminton", "1.0.0"],
      ["badminton", "1.1.0"],
      ["badminton", "1.2.0"],
      ["tank-maze", "1.0.0"],
      ["tank-maze", "1.1.0"],
      ["connect-four", "1.0.0"],
      ["connect-four", "1.1.0"],
      ["gomoku", "1.0.0"],
      ["gomoku", "1.1.0"],
      ["hex", "1.0.0"],
      ["reversi", "1.0.0"],
      ["reversi", "1.1.0"],
      ["chinese-checkers", "1.0.0"],
      ["chinese-checkers", "1.1.0"],
    ] as const) {
      const definition = resolveRoundSetupDefinition(gameId, gameVersion);
      expect(definition).toBeDefined();
      expect(resolveCurrentRoundSetupDefinition(gameId)).toBe(definition);
      expect(
        resolveRoundSetupDefinition(gameId, `${gameVersion}-unknown`),
      ).toBeUndefined();
    }
    expect(resolveCurrentRoundSetupDefinition("unknown")).toBeUndefined();
  });

  it("keeps exact 1.0.0 definitions frozen and independent from current rules", () => {
    for (const gameId of ["tic-tac-toe", "connect-four", "gomoku", "reversi"]) {
      const historical = resolveGameDefinition(gameId, "1.0.0");
      const current = resolveGameDefinition(gameId, "1.1.0");

      expect(historical).toBeDefined();
      expect(Object.isFrozen(historical)).toBe(true);
      expect(historical).not.toBe(current);
      expect(
        historical?.actionSchema.safeParse({ type: "RESIGN" }).success,
      ).toBe(false);
      expect(current?.actionSchema.safeParse({ type: "RESIGN" }).success).toBe(
        true,
      );
    }
  });

  it("preserves both Chinese Checkers geometries and their V6 setup", () => {
    const current = resolveCurrentGameDefinition("chinese-checkers");
    const legacy = resolveGameDefinition("chinese-checkers", "1.0.0");
    if (current === undefined || legacy === undefined) {
      throw new Error("Both Chinese Checkers versions must be registered.");
    }
    expect(current.manifest.gameVersion).toBe("1.1.0");
    expect(legacy).not.toBe(current);
    expect(Object.isFrozen(legacy)).toBe(true);
    expect(
      resolveRoundSetupDefinition("chinese-checkers", "1.0.0"),
    ).toBeDefined();
  });

  it("retains both historical Pong simulations for audit and disables player playback for every version", () => {
    const current = resolveCurrentRealtimeGameDefinition("pong");
    const legacy = resolveRealtimeGameDefinition("pong", "1.0.0");
    const previous = resolveRealtimeGameDefinition("pong", "1.1.0");
    expect(current?.manifest.gameVersion).toBe("1.2.0");
    expect(legacy).toBeDefined();
    expect(Object.isFrozen(legacy)).toBe(true);
    expect(legacy).not.toBe(current);
    expect(previous).toBeDefined();
    expect(previous).not.toBe(current);
    expect(Object.isFrozen(previous)).toBe(true);
    for (const definition of [legacy, previous, current]) {
      expect(definition?.manifest.capabilities.replay).toBe("record-only");
    }
  });

  it("resolves current and historical tank maze rules with compatible Surface entrypoints", () => {
    const current = resolveCurrentRealtimeGameDefinition("tank-maze");
    const previous = resolveRealtimeGameDefinition("tank-maze", "1.0.0");
    expect(current?.manifest.gameVersion).toBe("1.1.0");
    expect(previous?.manifest.gameVersion).toBe("1.0.0");
    expect(previous?.step).not.toBe(current?.step);
    for (const version of ["1.0.0", "1.1.0"]) {
      expect(resolveRoundSetupDefinition("tank-maze", version)).toBeDefined();
      expect(
        resolveGameSurfaceEntrypoint("tank-maze", version, "play")?.url,
      ).toBe("/game-surfaces/tank-maze/1.1.3/play/index.html");
      expect(resolveGameDeployment("tank-maze", version)?.setupProtocol).toBe(
        6,
      );
      expect(
        resolveGameDeployment("tank-maze", version)?.presentation,
      ).toMatchObject({
        artifact: {
          surfaceVersion: "1.1.3",
          supportedGameVersions: ["1.0.0", "1.1.0", "1.2.0"],
          contentDigest: "sha256-DmJbRFQzmeXrwcLuv9HT6mAMs2jtvsKtRROd5QbWYPs=",
        },
      });
      expect(
        resolveRealtimeGameDefinition("tank-maze", version)?.manifest
          .capabilities.replay,
      ).toBe("record-only");
      expect(
        resolveGameSurfaceEntrypoint("tank-maze", version, "replay"),
      ).toBeUndefined();
    }
  });

  it("registers badminton as an independent V6 Surface with server-only replay", () => {
    for (const gameVersion of ["1.0.0", "1.1.0", "1.2.0"] as const) {
      expect(resolveGameDeployment("badminton", gameVersion)).toMatchObject({
        setupProtocol: 6,
        presentation: {
          publicBasePath: "/game-surfaces/badminton/1.2.4",
          artifact: {
            supportedGameVersions: ["1.0.0", "1.1.0", "1.2.0"],
            surfaceVersion: "1.2.4",
            contentDigest:
              "sha256-39zjqU2yndwjoSvTiiT0q08gnTbzj23wZFElCNt3oUE=",
          },
        },
      });
      for (const mode of ["setup", "play"] as const) {
        expect(
          resolveGameSurfaceEntrypoint("badminton", gameVersion, mode),
        ).toMatchObject({
          gameVersion,
          surfaceVersion: "1.2.4",
          url: `/game-surfaces/badminton/1.2.4/${mode}/index.html`,
        });
      }
      expect(
        resolveGameSurfaceEntrypoint("badminton", gameVersion, "replay"),
      ).toBeUndefined();
    }
    expect(resolveGameManifest("badminton", "1.2.0")).toMatchObject({
      title: "火柴人羽毛球",
      runtime: "realtime",
      defaultConfig: { targetScore: 7 },
      capabilities: { replay: "record-only" },
    });
    expect(resolveGameDeployment("badminton", "1.0.0")).toMatchObject({
      setupProtocol: 6,
      platformControls: ["RESIGN"],
      presentation: { kind: "surface-v1", artifact: { bridgeVersion: 2 } },
    });
    for (const mode of ["setup", "play"] as const) {
      expect(
        resolveGameSurfaceEntrypoint("badminton", "1.0.0", mode),
      ).toMatchObject({
        url: `/game-surfaces/badminton/1.2.4/${mode}/index.html`,
        mode,
      });
    }
    expect(
      resolveGameSurfaceEntrypoint("badminton", "1.0.0", "replay"),
    ).toBeUndefined();
    const current = resolveCurrentRealtimeGameDefinition("badminton");
    const legacy = resolveRealtimeGameDefinition("badminton", "1.0.0");
    expect(current?.manifest.gameVersion).toBe("1.2.0");
    expect(current).not.toBe(legacy);
    expect(current?.step).not.toBe(legacy?.step);
    const previous = resolveRealtimeGameDefinition("badminton", "1.1.0");
    expect(previous?.manifest.gameVersion).toBe("1.1.0");
    expect(previous?.step).not.toBe(current?.step);
    expect(
      resolveGameSurfaceEntrypoint("badminton", "1.1.0", "play")?.url,
    ).toBe("/game-surfaces/badminton/1.2.4/play/index.html");
  });
});
