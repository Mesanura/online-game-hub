import { readFileSync } from "node:fs";
import {
  eraseRealtimeGameDefinition,
  verifyRealtimeReplay,
  type RealtimeCanonicalReplay,
} from "@online-game-hub/realtime-game-sdk";
import { describe, expect, it } from "vitest";

import { badmintonDefinition } from "../src/core/index.js";

const resolve = (gameId: string, gameVersion: string) =>
  gameId === "badminton" && gameVersion === "1.0.0"
    ? eraseRealtimeGameDefinition(badmintonDefinition)
    : undefined;
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/badminton-1.0.0-${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as RealtimeCanonicalReplay;

describe("badminton exact realtime golden records", () => {
  it.each(["resignation", "score", "rally"])(
    "reconstructs the frozen %s journal twice",
    (name) => {
      const replay = fixture(name);
      const result = verifyRealtimeReplay(replay, resolve);
      expect(result).toMatchObject({
        ok: true,
        result: {
          finalTick: replay.finalTick,
          outcome: replay.recordedOutcome,
          rng: { cursor: 0 },
        },
      });
      expect(verifyRealtimeReplay(replay, resolve)).toEqual(result);
    },
  );

  it("rejects tampered outcomes, actor, order, schema, RNG and version", () => {
    const replay = fixture("resignation");
    const altered = [
      {
        ...replay,
        recordedOutcome: {
          type: "WIN",
          reason: "SCORE",
          winnerSlotId: "right-slot",
          scores: [0, 7],
        },
      },
      {
        ...replay,
        events: replay.events.map((event) => ({
          ...event,
          actorSlotId: "outsider",
        })),
      },
      { ...replay, events: [...replay.events].reverse() },
      {
        ...replay,
        events: replay.events.map((event) => ({
          ...event,
          input: { ...(event.input as object), x: 0 },
        })),
      },
      { ...replay, recordedRngCursor: 1 },
      { ...replay, header: { ...replay.header, gameVersion: "9.0.0" } },
    ];
    for (const record of altered)
      expect(verifyRealtimeReplay(record, resolve).ok).toBe(false);
  });
});
