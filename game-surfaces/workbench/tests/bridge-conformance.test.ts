import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  hostSurfaceMessageSchema,
  surfaceHostMessageV2Schema,
} from "@online-game-hub/game-surface-bridge";

import { WORKBENCH_FIXTURES } from "../src/fixtures";
import {
  createWorkbenchSimulation,
  createWorkbenchStateMessage,
  updateWorkbenchSimulation,
} from "../src/simulator";
import { WORKBENCH_VIEWPORTS } from "../src/viewports";

const FORBIDDEN_KEYS = [
  "actor",
  "authoritativeState",
  "canonicalReplay",
  "commandId",
  "inputSequence",
  "rawState",
  "rng",
  "seed",
  "session",
  "ticket",
  "userId",
];

describe("Surface Workbench Bridge conformance", () => {
  it("covers every Surface mode with safe active and terminal projections", () => {
    expect(new Set(WORKBENCH_FIXTURES.map((fixture) => fixture.mode))).toEqual(
      new Set(["setup", "play", "replay"]),
    );

    for (const [index, fixture] of WORKBENCH_FIXTURES.entries()) {
      const active = createWorkbenchStateMessage(
        createWorkbenchSimulation(fixture),
        index * 2 + 1,
      );
      const terminal = createWorkbenchStateMessage(
        updateWorkbenchSimulation(createWorkbenchSimulation(fixture), {
          terminal: true,
        }),
        index * 2 + 2,
      );
      expect(hostSurfaceMessageSchema.safeParse(active).success).toBe(true);
      expect(hostSurfaceMessageSchema.safeParse(terminal).success).toBe(true);

      const serialized = JSON.stringify([active, terminal]);
      for (const key of FORBIDDEN_KEYS) {
        expect(serialized).not.toContain(`"${key}"`);
      }
    }
  });

  it("contains the complete acceptance viewport matrix", () => {
    expect(
      WORKBENCH_VIEWPORTS.map(({ width, height }) => `${width}x${height}`),
    ).toEqual([
      "1366x768",
      "1440x900",
      "1920x1080",
      "1024x768",
      "768x1024",
      "390x844",
      "412x915",
      "844x390",
    ]);
  });

  it("accepts a bounded Bridge V2 terminal result summary", () => {
    expect(
      surfaceHostMessageV2Schema.parse({
        type: "surface.result-summary",
        stateSequence: 7,
        tone: "win",
        headline: "你获胜",
        details: ["黑方 35 · 白方 29"],
      }),
    ).toMatchObject({
      type: "surface.result-summary",
      stateSequence: 7,
      tone: "win",
    });
  });

  it("remains a non-published workspace with no Platform runtime dependency", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      readonly onlineGameHub?: { readonly surfaceArtifact?: boolean };
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly scripts?: Readonly<Record<string, string>>;
    };

    expect(packageJson.onlineGameHub?.surfaceArtifact).toBe(false);
    expect(Object.keys(packageJson.dependencies ?? {})).toEqual([
      "@online-game-hub/game-surface-bridge",
    ]);
    expect(packageJson.scripts).toMatchObject({
      dev: expect.any(String),
      build: expect.any(String),
      test: expect.any(String),
      "contract-test": expect.any(String),
    });
  });
});
