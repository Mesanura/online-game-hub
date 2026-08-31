import { describe, expect, it } from "vitest";

import { gameCatalog, resolveGameManifest } from "../src/catalog.js";
import {
  loadGameClientEntrypoint,
  loadGameClientModule,
} from "../src/client.js";
import {
  resolveCurrentGameDefinition,
  resolveGameDefinition,
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
      gameCatalog.slice(0, 5).map(({ id, title }) => ({ id, title })),
    ).toEqual([
      { id: "tic-tac-toe", title: "井字棋" },
      { id: "connect-four", title: "四子棋" },
      { id: "gomoku", title: "五子棋" },
      { id: "hex", title: "六贯棋" },
      { id: "reversi", title: "黑白棋" },
    ]);
    expect(new Set(gameCatalog.map(({ id }) => id)).size).toBe(
      gameCatalog.length,
    );

    for (const manifest of gameCatalog) {
      expect(resolveGameManifest(manifest.id, manifest.gameVersion)).toBe(
        manifest,
      );
      const definition = resolveGameDefinition(
        manifest.id,
        manifest.gameVersion,
      );
      expect(definition?.manifest).toBe(manifest);
      expect(definition?.configSchema.parse(manifest.defaultConfig)).toEqual(
        manifest.defaultConfig,
      );
    }
  });

  it("resolves only exact gameId + gameVersion", () => {
    expect(resolveGameDefinition("unknown", "1.0.0")).toBeUndefined();
    expect(resolveGameManifest("unknown", "1.0.0")).toBeUndefined();

    for (const manifest of gameCatalog) {
      expect(
        resolveGameDefinition(manifest.id, `${manifest.gameVersion}-unknown`),
      ).toBeUndefined();
      expect(
        resolveGameManifest(manifest.id, `${manifest.gameVersion}-unknown`),
      ).toBeUndefined();
    }
  });

  it("selects each explicitly registered current definition for new rooms", () => {
    for (const manifest of gameCatalog) {
      expect(resolveCurrentGameDefinition(manifest.id)).toBe(
        resolveGameDefinition(manifest.id, manifest.gameVersion),
      );
    }
    expect(resolveCurrentGameDefinition("unknown")).toBeUndefined();
  });

  it("keeps every client entry lazy, isolated, and free of UI business", async () => {
    for (const manifest of gameCatalog) {
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
      await expect(
        loadGameClientModule(manifest.id, `${manifest.gameVersion}-unknown`),
      ).resolves.toBeUndefined();
    }
  });
});
