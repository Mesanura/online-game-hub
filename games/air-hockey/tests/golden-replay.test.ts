import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  eraseRealtimeGameDefinition,
  verifyRealtimeReplay,
} from "@online-game-hub/realtime-game-sdk";
import { describe, expect, it } from "vitest";

import {
  airHockeyDefinition,
  airHockeyDefinitionV1_0_0,
} from "../src/core/index.js";

const definitions = [airHockeyDefinitionV1_0_0, airHockeyDefinition].map(
  eraseRealtimeGameDefinition,
);
const resolve = (id: string, version: string) =>
  definitions.find(
    ({ manifest }) => manifest.id === id && manifest.gameVersion === version,
  );
const cases = [
  [
    "1.0.0",
    "score-5",
    261,
    "6235cfb465b72b432e0eefc247ef15a06037bff57de88e9c8e366c699f41822a",
  ],
  [
    "1.0.0",
    "score-7",
    377,
    "3848c3fe2d588d163b2458c99ae21da36e7f6dd5ded4ce7cf808dc6ddbda0996",
  ],
  [
    "1.0.0",
    "score-11",
    609,
    "402456ae9c71f2187a4fc5ab7b37813faf179e8e3109f8c1bd125c0bfea6d7a1",
  ],
  [
    "1.0.0",
    "rally-resignation",
    181,
    "7ef874b2727690d85fd43ab3eb854c181764d5d72b68d36c94a531d781543db5",
  ],
  [
    "1.1.0",
    "score-5",
    234,
    "5a265a668eeda9d4556f59a431d9c291b8174173122ab2fa9457c0984e333345",
  ],
  [
    "1.1.0",
    "score-7",
    338,
    "8116dd3d91df0b9663d598d1b2b16a6a5ce5e4440c067e5d5a76bc2305d86ba1",
  ],
  [
    "1.1.0",
    "score-11",
    546,
    "907661f289bde40a73186570bdfba62168a69ee8f64bc405bf090396216572d4",
  ],
  [
    "1.1.0",
    "squeeze-resignation",
    181,
    "04cb6a2c4513eeb001e4044f731433614566f9f4395e6470a1e9799bacc52521",
  ],
] as const;

describe("air hockey exact-version golden records", () => {
  it.each(cases)(
    "exactly rebuilds %s/%s, including full integer state and collision events",
    (version, name, finalTick, hash) => {
      const fixture = JSON.parse(
        readFileSync(
          new URL(
            `./fixtures/air-hockey-${version}-${name}.json`,
            import.meta.url,
          ),
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
