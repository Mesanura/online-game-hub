import { describe, expect, it } from "vitest";

import { connectFourDefinition } from "@online-game-hub/connect-four/core";
import { connectFourManifest } from "@online-game-hub/connect-four/manifest";
import { gomokuDefinition } from "@online-game-hub/gomoku/core";
import { gomokuManifest } from "@online-game-hub/gomoku/manifest";
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
    expect(gameCatalog).toEqual([
      ticTacToeManifest,
      connectFourManifest,
      gomokuManifest,
    ]);
    expect(gameCatalog.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: "tic-tac-toe", title: "井字棋" },
      { id: "connect-four", title: "四子棋" },
      { id: "gomoku", title: "五子棋" },
    ]);
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
    expect(resolveGameManifest("gomoku", "1.0.0")).toBe(gomokuManifest);
    expect(resolveGameDefinition("gomoku", "1.0.0")).toBe(gomokuDefinition);
    expect(gomokuDefinition.manifest).toBe(gomokuManifest);
    for (const manifest of gameCatalog) {
      const definition = resolveGameDefinition(
        manifest.id,
        manifest.gameVersion,
      );
      expect(definition?.configSchema.parse(manifest.defaultConfig)).toEqual(
        manifest.defaultConfig,
      );
    }
  });

  it("resolves only exact gameId + gameVersion", () => {
    expect(resolveGameDefinition("unknown", "1.0.0")).toBeUndefined();
    expect(resolveGameDefinition("tic-tac-toe", "1.0.1")).toBeUndefined();
    expect(resolveGameDefinition("tic-tac-toe", "^1.0.0")).toBeUndefined();
    expect(resolveGameDefinition("connect-four", "1.0.1")).toBeUndefined();
    expect(resolveGameDefinition("gomoku", "1.0.1")).toBeUndefined();
    expect(resolveGameManifest("tic-tac-toe", "latest")).toBeUndefined();
  });

  it("selects the explicitly registered current exact version for new rooms", () => {
    expect(resolveCurrentGameDefinition("tic-tac-toe")).toBe(
      ticTacToeDefinition,
    );
    expect(resolveCurrentGameDefinition("connect-four")).toBe(
      connectFourDefinition,
    );
    expect(resolveCurrentGameDefinition("gomoku")).toBe(gomokuDefinition);
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

    const connectFourEntrypoint = await loadGameClientEntrypoint(
      "connect-four",
      "1.0.0",
    );
    expect(connectFourEntrypoint).toBeDefined();
    expect(connectFourEntrypoint).toHaveProperty("connectFourClientModule");
    expect(connectFourEntrypoint).not.toHaveProperty("transition");
    expect(connectFourEntrypoint).not.toHaveProperty("createInitialState");

    const connectFourClient = await loadGameClientModule(
      "connect-four",
      "1.0.0",
    );
    expect(connectFourClient).toMatchObject({
      gameId: "connect-four",
      gameVersion: "1.0.0",
    });
    expect(connectFourClient?.parseView).toEqual(expect.any(Function));
    await expect(
      loadGameClientModule("connect-four", "1.0.1"),
    ).resolves.toBeUndefined();

    const gomokuEntrypoint = await loadGameClientEntrypoint("gomoku", "1.0.0");
    expect(gomokuEntrypoint).toBeDefined();
    expect(gomokuEntrypoint).toHaveProperty("gomokuClientModule");
    expect(gomokuEntrypoint).not.toHaveProperty("transition");
    expect(gomokuEntrypoint).not.toHaveProperty("createInitialState");

    const gomokuClient = await loadGameClientModule("gomoku", "1.0.0");
    expect(gomokuClient).toMatchObject({
      gameId: "gomoku",
      gameVersion: "1.0.0",
    });
    expect(gomokuClient?.parseView).toEqual(expect.any(Function));
    await expect(
      loadGameClientModule("gomoku", "1.0.1"),
    ).resolves.toBeUndefined();
  });
});
