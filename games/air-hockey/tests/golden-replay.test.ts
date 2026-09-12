import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  eraseRealtimeGameDefinition,
  verifyRealtimeReplay,
} from "@online-game-hub/realtime-game-sdk";
import { describe, expect, it } from "vitest";

import { airHockeyDefinition } from "../src/core/index.js";

const resolve = (id: string, version: string) =>
  id === "air-hockey" && version === "1.0.0"
    ? eraseRealtimeGameDefinition(airHockeyDefinition)
    : undefined;
const cases = [
  [
    "score-5",
    261,
    "6235cfb465b72b432e0eefc247ef15a06037bff57de88e9c8e366c699f41822a",
  ],
  [
    "score-7",
    377,
    "3848c3fe2d588d163b2458c99ae21da36e7f6dd5ded4ce7cf808dc6ddbda0996",
  ],
  [
    "score-11",
    609,
    "402456ae9c71f2187a4fc5ab7b37813faf179e8e3109f8c1bd125c0bfea6d7a1",
  ],
  [
    "rally-resignation",
    181,
    "7ef874b2727690d85fd43ab3eb854c181764d5d72b68d36c94a531d781543db5",
  ],
] as const;

describe("air hockey 1.0.0 golden records", () => {
  it.each(cases)(
    "exactly rebuilds %s, including full integer state and collision events",
    (name, finalTick, hash) => {
      const fixture = JSON.parse(
        readFileSync(
          new URL(`./fixtures/air-hockey-1.0.0-${name}.json`, import.meta.url),
          "utf8",
        ),
      ) as {
        finalTick: number;
        recordedRngCursor: number;
        recordedOutcome: unknown;
        events: Record<string, unknown>[];
      };
      const result = verifyRealtimeReplay(fixture, resolve);
      expect(result).toEqual(verifyRealtimeReplay(fixture, resolve));
      expect(result).toMatchObject({
        ok: true,
        result: {
          finalTick,
          outcome: fixture.recordedOutcome,
          rng: { cursor: 0 },
        },
      });
      if (!result.ok) throw new Error(result.message);
      expect(
        createHash("sha256")
          .update(JSON.stringify(result.result.state))
          .digest("hex"),
      ).toBe(hash);
      expect(
        verifyRealtimeReplay({ ...fixture, finalTick: finalTick - 1 }, resolve)
          .ok,
      ).toBe(false);
      expect(
        verifyRealtimeReplay({ ...fixture, recordedRngCursor: 1 }, resolve),
      ).toMatchObject({ ok: false, code: "RNG_MISMATCH" });
      expect(
        verifyRealtimeReplay(
          {
            ...fixture,
            events: [
              { ...fixture.events[0], actorSlotId: "forged" },
              ...fixture.events.slice(1),
            ],
          },
          resolve,
        ),
      ).toMatchObject({ ok: false, code: "UNKNOWN_ACTOR" });
    },
  );
});
