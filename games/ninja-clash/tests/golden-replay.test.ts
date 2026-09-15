import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  eraseRealtimeGameDefinition,
  verifyRealtimeReplay,
  type RealtimeCanonicalReplay,
} from "@online-game-hub/realtime-game-sdk";
import { ninjaClashDefinition } from "../src/core/index.js";
const definition = eraseRealtimeGameDefinition(ninjaClashDefinition);
const resolve = (id: string, version: string) =>
  id === "ninja-clash" && version === "1.0.0" ? definition : undefined;
it.each([2, 3, 4])(
  "rebuilds the exact %i-player multi-round combat record",
  (count) => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/ninja-clash-1.0.0-" + count + "p.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { replay: RealtimeCanonicalReplay; stateHash: string };
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
