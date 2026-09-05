import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Surface-only Web rendering boundary", () => {
  it("does not load legacy game client modules in live rooms or replay", () => {
    const roomHost = source("../src/components/game-room-host.tsx");
    const roomPage = source("../src/components/game-room-page.tsx");
    const replayPage = source(
      "../src/app/account/matches/[matchId]/replay/page.tsx",
    );

    for (const webSource of [roomHost, roomPage, replayPage]) {
      expect(webSource).not.toContain("loadGameClientModule");
      expect(webSource).not.toContain("loadRealtimeGameClientModule");
      expect(webSource).not.toContain("UnknownGameClientModule");
      expect(webSource).not.toContain("UnknownRealtimeGameClientModule");
    }
    expect(roomPage).not.toContain(".parseView(");
    expect(replayPage).not.toContain(".parseView(");
  });

  it("routes platform resignation through the restricted Surface command", () => {
    const frame = source("../src/components/game-surface-frame.tsx");
    const roomPage = source("../src/components/game-room-page.tsx");

    expect(frame).toContain('type: "host.command"');
    expect(frame).toContain('control: "RESIGN"');
    expect(roomPage).toContain("surface.requestResign()");
    expect(roomPage).not.toContain("createResignAction");
    expect(roomPage).not.toContain("createResignInput");
  });

  it("keeps game-specific presentation CSS out of the website shell", () => {
    const styles = source("../src/app/styles.css");
    for (const selector of [
      ".game-board-panel",
      ".pong-panel",
      ".tic-tac-toe-board",
      ".connect-four-board",
      ".gomoku-board",
      ".reversi-board",
      ".hex-board",
      ".chinese-checkers-board",
    ]) {
      expect(styles).not.toContain(selector);
    }
  });
});
