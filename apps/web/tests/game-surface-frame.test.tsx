import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ResolvedSurfaceEntrypoint } from "@online-game-hub/game-registry/deployment";

import { GameSurfaceFrame } from "../src/components/game-surface-frame";

const entrypoint: ResolvedSurfaceEntrypoint = {
  gameId: "tic-tac-toe",
  gameVersion: "1.1.0",
  surfaceVersion: "1.0.2",
  mode: "play",
  platformControls: ["RESIGN"],
  url: "/game-surfaces/tic-tac-toe/1.0.2/play/index.html",
  artifact: {
    schemaVersion: 1,
    gameId: "tic-tac-toe",
    supportedGameVersions: ["1.0.0", "1.1.0"],
    surfaceVersion: "1.0.2",
    bridgeVersion: 1,
    entrypoints: {
      setup: "setup/index.html",
      play: "play/index.html",
    },
    capabilities: { pointerLock: true },
    contentDigest: `sha256-${"A".repeat(43)}=`,
  },
};

describe("GameSurfaceFrame", () => {
  it("renders an opaque sandboxed iframe without navigation or same-origin powers", () => {
    const html = renderToStaticMarkup(
      <GameSurfaceFrame
        connectionState="connected"
        entrypoint={entrypoint}
        locale="zh-CN"
        onIntent={() => Promise.resolve({ status: "accepted" })}
        outcome={null}
        payload={{ board: [null, null, null] }}
        readOnly={false}
        reducedMotion={false}
        revision={0}
        roundNumber={1}
      />,
    );

    expect(html).toContain('sandbox="allow-scripts allow-pointer-lock"');
    expect(html).not.toContain("allow-same-origin");
    expect(html).not.toContain("allow-forms");
    expect(html).not.toContain("allow-popups");
    expect(html).not.toContain("allow-top-navigation");
    expect(html).toContain(`src="${entrypoint.url}"`);
    expect(html).toContain('referrerPolicy="no-referrer"');
  });
});
