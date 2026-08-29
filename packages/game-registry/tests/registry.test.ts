import { describe, expect, it } from "vitest";

import { ticTacToeDefinition } from "@online-game-hub/tic-tac-toe/core";
import { ticTacToeManifest } from "@online-game-hub/tic-tac-toe/manifest";

import { gameCatalog, resolveGameManifest } from "../src/catalog.js";
import { loadGameClientEntrypoint } from "../src/client.js";
import { resolveGameDefinition } from "../src/server.js";

describe("explicit game registry", () => {
  it("uses the game's single manifest source in the catalog and server", () => {
    expect(gameCatalog).toEqual([ticTacToeManifest]);
    expect(resolveGameManifest("tic-tac-toe", "1.0.0")).toBe(ticTacToeManifest);
    expect(resolveGameDefinition("tic-tac-toe", "1.0.0")).toBe(
      ticTacToeDefinition,
    );
    expect(ticTacToeDefinition.manifest).toBe(ticTacToeManifest);
  });

  it("resolves only exact gameId + gameVersion", () => {
    expect(resolveGameDefinition("unknown", "1.0.0")).toBeUndefined();
    expect(resolveGameDefinition("tic-tac-toe", "1.0.1")).toBeUndefined();
    expect(resolveGameDefinition("tic-tac-toe", "^1.0.0")).toBeUndefined();
    expect(resolveGameManifest("tic-tac-toe", "latest")).toBeUndefined();
  });

  it("keeps the client entry lazy, isolated, and free of UI business", async () => {
    const entrypoint = await loadGameClientEntrypoint("tic-tac-toe", "1.0.0");
    expect(entrypoint).toBeDefined();
    expect(Object.keys(entrypoint as object)).toEqual([]);
    await expect(
      loadGameClientEntrypoint("tic-tac-toe", "2.0.0"),
    ).resolves.toBeUndefined();
  });
});
