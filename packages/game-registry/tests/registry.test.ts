import { describe, expect, it } from "vitest";

import { connectFourDefinition } from "@online-game-hub/connect-four/core";
import { connectFourManifest } from "@online-game-hub/connect-four/manifest";
import { ticTacToeDefinition } from "@online-game-hub/tic-tac-toe/core";
import { ticTacToeManifest } from "@online-game-hub/tic-tac-toe/manifest";

import { gameCatalog, resolveGameManifest } from "../src/catalog.js";
import {
  loadGameClientEntrypoint,
  loadGameClientModule,
} from "../src/client.js";
import {
  resolveCurrentGameDefinition,
  resolveGameDefinition,
} from "../src/server.js";

describe("explicit game registry", () => {
  it("uses the game's single manifest source in the catalog and server", () => {
    expect(gameCatalog).toEqual([ticTacToeManifest, connectFourManifest]);
    expect(resolveGameManifest("tic-tac-toe", "1.0.0")).toBe(ticTacToeManifest);
    expect(resolveGameDefinition("tic-tac-toe", "1.0.0")).toBe(
      ticTacToeDefinition,
    );
    expect(ticTacToeDefinition.manifest).toBe(ticTacToeManifest);
    expect(resolveGameManifest("connect-four", "1.0.0")).toBe(
      connectFourManifest,
    );
    expect(resolveGameDefinition("connect-four", "1.0.0")).toBe(
      connectFourDefinition,
    );
    expect(connectFourDefinition.manifest).toBe(connectFourManifest);
  });

  it("resolves only exact gameId + gameVersion", () => {
    expect(resolveGameDefinition("unknown", "1.0.0")).toBeUndefined();
    expect(resolveGameDefinition("tic-tac-toe", "1.0.1")).toBeUndefined();
    expect(resolveGameDefinition("tic-tac-toe", "^1.0.0")).toBeUndefined();
    expect(resolveGameDefinition("connect-four", "1.0.1")).toBeUndefined();
    expect(resolveGameManifest("tic-tac-toe", "latest")).toBeUndefined();
  });

  it("selects the explicitly registered current exact version for new rooms", () => {
    expect(resolveCurrentGameDefinition("tic-tac-toe")).toBe(
      ticTacToeDefinition,
    );
    expect(resolveCurrentGameDefinition("connect-four")).toBe(
      connectFourDefinition,
    );
    expect(resolveCurrentGameDefinition("unknown")).toBeUndefined();
  });

  it("keeps the client entry lazy, isolated, and free of UI business", async () => {
    const entrypoint = await loadGameClientEntrypoint("tic-tac-toe", "1.0.0");
    expect(entrypoint).toBeDefined();
    expect(entrypoint).toHaveProperty("ticTacToeClientModule");
    expect(entrypoint).not.toHaveProperty("transition");
    expect(entrypoint).not.toHaveProperty("createInitialState");

    const clientModule = await loadGameClientModule("tic-tac-toe", "1.0.0");
    expect(clientModule).toMatchObject({
      gameId: "tic-tac-toe",
      gameVersion: "1.0.0",
    });
    expect(clientModule?.parseView).toEqual(expect.any(Function));
    await expect(
      loadGameClientModule("tic-tac-toe", "2.0.0"),
    ).resolves.toBeUndefined();
  });
});
