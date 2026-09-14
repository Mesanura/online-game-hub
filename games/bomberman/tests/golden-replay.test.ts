import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  eraseRealtimeGameDefinition,
  verifyRealtimeReplay,
  type RealtimeCanonicalReplay,
} from "@online-game-hub/realtime-game-sdk";
import { bombermanDefinition } from "../src/core/index.js";
const definition = eraseRealtimeGameDefinition(bombermanDefinition);
const resolve = (id: string, version: string) =>
  id === "bomberman" && version === "1.0.0" ? definition : undefined;
type Fixture = { replay: RealtimeCanonicalReplay; stateHash: string };
it.each([2, 3, 4])(
  "rebuilds the frozen %i-player three-bout record and complete state",
  (count) => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/bomberman-1.0.0-" + count + "p.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Fixture;
    const result = verifyRealtimeReplay(fixture.replay, resolve);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.result.outcome).toMatchObject({
      type: "WIN",
      winnerSlotId: "p" + (count - 1),
      reason: "SCORE",
    });
    expect(result.result.state).toMatchObject({ bout: 3, phase: "COMPLETE" });
    expect(
      createHash("sha256")
        .update(JSON.stringify(result.result.state))
        .digest("hex"),
    ).toBe(fixture.stateHash);
    expect(verifyRealtimeReplay(fixture.replay, resolve)).toEqual(result);
    expect(
      verifyRealtimeReplay(
        { ...fixture.replay, recordedRngCursor: -1 },
        resolve,
      ).ok,
    ).toBe(false);
    expect(
      verifyRealtimeReplay(
        {
          ...fixture.replay,
          events: fixture.replay.events.map((event) => ({
            ...event,
            actorSlotId: "outsider",
          })),
        },
        resolve,
      ).ok,
    ).toBe(false);
    expect(
      verifyRealtimeReplay(
        { ...fixture.replay, recordedOutcome: { type: "DRAW" } },
        resolve,
      ).ok,
    ).toBe(false);
  },
);
