import { describe, expect, it } from "vitest";

import { gameCatalog, resolveGameManifest } from "../src/catalog.js";
import {
  loadGameClientEntrypoint,
  loadGameClientModule,
  loadRealtimeGameClientEntrypoint,
  loadRealtimeGameClientModule,
} from "../src/client.js";
import {
  resolveCurrentGameDeployment,
  resolveGameDeployment,
  resolveGameSurfaceEntrypoint,
  resolveSurfaceEntrypoint,
  type GameDeploymentRegistration,
} from "../src/deployment.js";
import {
  resolveCurrentGameDefinition,
  resolveCurrentRealtimeGameDefinition,
  resolveGameDefinition,
  resolveRealtimeGameDefinition,
} from "../src/server.js";

function clientModuleSymbol(gameId: string): string {
  const [firstSegment, ...remainingSegments] = gameId.split("-");
  if (firstSegment === undefined) {
    throw new Error("A registered game id must contain a symbol segment.");
  }

  return `${firstSegment}${remainingSegments
    .map((segment) => `${segment[0]?.toUpperCase()}${segment.slice(1)}`)
    .join("")}ClientModule`;
}

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
      expect(manifest.capabilities.replay).toBe("player-playback");
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
        setupProtocol: 5,
        presentation: { kind: "legacy-react" },
      });
      expect(resolveCurrentGameDeployment(manifest.id)).toEqual(
        resolveGameDeployment(manifest.id, manifest.gameVersion),
      );
    }
  });

  it("resolves only exact gameId + gameVersion", () => {
    expect(resolveGameDefinition("unknown", "1.0.0")).toBeUndefined();
    expect(resolveGameManifest("unknown", "1.0.0")).toBeUndefined();

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
    }
  });

  it("resolves Surface artifacts by exact game, version and mode", () => {
    const registration: GameDeploymentRegistration = {
      gameId: "fixture-game",
      gameVersion: "1.0.0",
      setupProtocol: 6,
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
      url: "/game-surfaces/fixture-game/2.0.0/setup/index.html",
    });
    expect(resolveSurfaceEntrypoint(registration, "replay")).toBeUndefined();
    expect(
      resolveSurfaceEntrypoint(
        { ...registration, gameVersion: "1.1.0" },
        "play",
      ),
    ).toBeUndefined();
    expect(
      resolveGameSurfaceEntrypoint("tic-tac-toe", "1.1.0", "play"),
    ).toBeUndefined();
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

  it("resolves every supported exact historical client module independently", async () => {
    const historicalVersions = [
      ["tic-tac-toe", "1.0.0"],
      ["connect-four", "1.0.0"],
      ["gomoku", "1.0.0"],
      ["hex", "1.0.0"],
      ["reversi", "1.0.0"],
    ] as const;
    for (const [gameId, gameVersion] of historicalVersions) {
      const historical = await loadGameClientModule(gameId, gameVersion);
      const current = await loadGameClientModule(
        gameId,
        gameCatalog.find((manifest) => manifest.id === gameId)?.gameVersion ??
          "",
      );
      expect(historical).toBeDefined();
      expect(current).toBeDefined();
      if (gameId !== "hex") expect(historical).not.toBe(current);
      expect(historical).toMatchObject({ gameId, gameVersion });
      expect(historical?.parseView).toEqual(expect.any(Function));
    }
  });

  it("keeps every client entry lazy, isolated, and free of UI business", async () => {
    for (const manifest of gameCatalog) {
      if (manifest.runtime === "realtime") {
        const entrypoint = await loadRealtimeGameClientEntrypoint(
          manifest.id,
          manifest.gameVersion,
        );
        expect(entrypoint).toHaveProperty(clientModuleSymbol(manifest.id));
        expect(entrypoint).not.toHaveProperty("step");
        expect(entrypoint).not.toHaveProperty("createInitialState");
        const clientModule = await loadRealtimeGameClientModule(
          manifest.id,
          manifest.gameVersion,
        );
        expect(clientModule).toMatchObject({
          gameId: manifest.id,
          gameVersion: manifest.gameVersion,
        });
        expect(clientModule?.parseView).toEqual(expect.any(Function));
        expect(clientModule?.createResignInput).toEqual(expect.any(Function));
        await expect(
          loadRealtimeGameClientModule(
            manifest.id,
            `${manifest.gameVersion}-unknown`,
          ),
        ).resolves.toBeUndefined();
        continue;
      }
      const entrypoint = await loadGameClientEntrypoint(
        manifest.id,
        manifest.gameVersion,
      );
      expect(entrypoint).toBeDefined();
      expect(entrypoint).toHaveProperty(clientModuleSymbol(manifest.id));
      expect(entrypoint).not.toHaveProperty("transition");
      expect(entrypoint).not.toHaveProperty("createInitialState");

      const clientModule = await loadGameClientModule(
        manifest.id,
        manifest.gameVersion,
      );
      expect(clientModule).toMatchObject({
        gameId: manifest.id,
        gameVersion: manifest.gameVersion,
      });
      expect(clientModule?.parseView).toEqual(expect.any(Function));
      expect(clientModule?.createResignAction).toEqual(expect.any(Function));
      await expect(
        loadGameClientModule(manifest.id, `${manifest.gameVersion}-unknown`),
      ).resolves.toBeUndefined();
    }
  });
});
