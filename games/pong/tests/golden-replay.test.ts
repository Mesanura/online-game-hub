import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  eraseRealtimeGameDefinition,
  verifyRealtimeReplay,
} from "@online-game-hub/realtime-game-sdk";

import { pongDefinition, pongDefinitionV1_0_0 } from "../src/core/index.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/pong-1.0.0-resignation.json", import.meta.url),
    "utf8",
  ),
) as unknown;

const resolve = (gameId: string, gameVersion: string) =>
  gameId === "pong"
    ? [
        eraseRealtimeGameDefinition(pongDefinitionV1_0_0),
        eraseRealtimeGameDefinition(pongDefinition),
      ].find((definition) => definition.manifest.gameVersion === gameVersion)
    : undefined;

describe("Pong realtime golden replay", () => {
  it.each([
    ["1.0.0", 326],
    ["1.1.0", 956],
  ] as const)(
    "rebuilds every serve and score with exact %s rules",
    (gameVersion, finalTick) => {
      const currentFixture = JSON.parse(
        readFileSync(
          new URL(`./fixtures/pong-${gameVersion}-score.json`, import.meta.url),
          "utf8",
        ),
      ) as {
        finalTick: number;
        recordedRngCursor: number;
        recordedOutcome: unknown;
      };
      const first = verifyRealtimeReplay(currentFixture, resolve);
      expect(first).toEqual(verifyRealtimeReplay(currentFixture, resolve));
      expect(first).toMatchObject({
        ok: true,
        result: {
          finalTick,
          outcome: currentFixture.recordedOutcome,
        },
      });
      expect(
        verifyRealtimeReplay(
          { ...currentFixture, finalTick: currentFixture.finalTick - 1 },
          resolve,
        ).ok,
      ).toBe(false);
      expect(
        verifyRealtimeReplay(
          {
            ...currentFixture,
            recordedRngCursor: currentFixture.recordedRngCursor + 2,
          },
          resolve,
        ).ok,
      ).toBe(false);
    },
  );

  it("exactly rebuilds the recorded outcome", () => {
    const first = verifyRealtimeReplay(fixture, resolve);
    const second = verifyRealtimeReplay(fixture, resolve);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      result: {
        finalTick: 3,
        outcome: {
          type: "WIN",
          reason: "RESIGNATION",
          winnerSlotId: "left-slot",
        },
      },
    });
  });

  it("rejects tampered outcome and event tick", () => {
    const replay = fixture as {
      readonly recordedOutcome: unknown;
      readonly events: readonly Record<string, unknown>[];
    };
    expect(
      verifyRealtimeReplay(
        {
          ...replay,
          recordedOutcome: {
            type: "WIN",
            reason: "SCORE",
            winnerSlotId: "right-slot",
            scores: [0, 1],
          },
        },
        resolve,
      ),
    ).toMatchObject({ ok: false, code: "OUTCOME_MISMATCH" });
    expect(
      verifyRealtimeReplay(
        {
          ...replay,
          events: [
            { ...replay.events[0], tick: 1 },
            { ...replay.events[1], tick: 0 },
          ],
        },
        resolve,
      ),
    ).toMatchObject({ ok: false, code: "TICK_ORDER" });
  });
});
