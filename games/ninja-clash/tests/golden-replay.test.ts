import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  defineRealtimePlayerSlotId,
  eraseRealtimeGameDefinition,
  verifyRealtimeReplay,
  type RealtimeCanonicalReplay,
} from "@online-game-hub/realtime-game-sdk";
import {
  ninjaClashDefinition,
  ninjaClashDefinitionV1_0_0,
} from "../src/core/index.js";
const definitions = [
  eraseRealtimeGameDefinition(ninjaClashDefinition),
  eraseRealtimeGameDefinition(ninjaClashDefinitionV1_0_0),
];
const resolve = (id: string, version: string) =>
  definitions.find(
    (d) => d.manifest.id === id && d.manifest.gameVersion === version,
  );
it.each(
  ["1.0.0", "1.1.0"].flatMap((version) =>
    [2, 3, 4].map((count) => ({ version, count })),
  ),
)(
  "rebuilds the exact $version $count-player multi-round combat record",
  ({ version, count }) => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/ninja-clash-" + version + "-" + count + "p.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      replay: RealtimeCanonicalReplay;
      stateHash: string;
      clashCheckpoint?: { tick: number; view: unknown };
    };
    const result = verifyRealtimeReplay(fixture.replay, resolve);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.result.outcome).toMatchObject({
      type: "WIN",
      winnerSlotId: "p0",
      reason: "TARGET_SCORE",
    });
    expect(result.result.state).toMatchObject({ round: 3, phase: "FINISHED" });
    expect(
      createHash("sha256")
        .update(JSON.stringify(result.result.state))
        .digest("hex"),
    ).toBe(fixture.stateHash);
    expect(verifyRealtimeReplay(fixture.replay, resolve)).toEqual(result);
    if (fixture.clashCheckpoint) {
      const checkpoint = fixture.clashCheckpoint;
      const part = verifyRealtimeReplay(
        {
          ...fixture.replay,
          events: fixture.replay.events.filter((e) => e.tick < checkpoint.tick),
          finalTick: checkpoint.tick,
          recordedOutcome: null,
          recordedRngCursor: null,
        },
        resolve,
      );
      if (!part.ok) throw new Error(part.code);
      expect(
        resolve("ninja-clash", version)?.projectView({
          state: part.result.state,
          viewer: {
            kind: "player",
            slotId: defineRealtimePlayerSlotId("p0"),
          },
        }),
      ).toEqual(checkpoint.view);
    }
    expect(
      verifyRealtimeReplay({ ...fixture.replay, recordedRngCursor: 9 }, resolve)
        .ok,
    ).toBe(false);
    expect(
      verifyRealtimeReplay(
        { ...fixture.replay, recordedOutcome: { type: "DRAW" } },
        resolve,
      ).ok,
    ).toBe(false);
    expect(
      verifyRealtimeReplay(
        {
          ...fixture.replay,
          events: fixture.replay.events.map((e) => ({
            ...e,
            actorSlotId: "outsider",
          })),
        },
        resolve,
      ).ok,
    ).toBe(false);
  },
);
