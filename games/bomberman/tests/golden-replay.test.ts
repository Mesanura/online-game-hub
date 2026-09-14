import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  eraseRealtimeGameDefinition,
  verifyRealtimeReplay,
  type RealtimeCanonicalReplay,
} from "@online-game-hub/realtime-game-sdk";
import {
  bombermanDefinition,
  bombermanDefinitionV1_0_0,
  bombermanDefinitionV1_1_0,
} from "../src/core/index.js";
const definitions = [
  eraseRealtimeGameDefinition(bombermanDefinition),
  eraseRealtimeGameDefinition(bombermanDefinitionV1_0_0),
  eraseRealtimeGameDefinition(bombermanDefinitionV1_1_0),
];
const resolve = (id: string, version: string) =>
  definitions.find(
    (game) => game.manifest.id === id && game.manifest.gameVersion === version,
  );
type Fixture = {
  replay: RealtimeCanonicalReplay;
  stateHash: string;
  dropCheckpoint?: { tick: number; players: unknown[]; pickups: unknown[] };
};
it.each([
  ...["1.0.0", "1.1.0", "1.2.0"].flatMap((version) =>
    [2, 3, 4].map((count) => ({ version, count, scenario: count + "p" })),
  ),
  { version: "1.2.0", count: 2, scenario: "drops" },
])(
  "rebuilds the frozen $version $scenario record and complete state",
  ({ version, count, scenario }) => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/bomberman-" + version + "-" + scenario + ".json",
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
      reason: version === "1.0.0" ? "SCORE" : "SURVIVOR",
    });
    expect(result.result.state).toMatchObject({ phase: "COMPLETE" });
    if (version === "1.0.0")
      expect(result.result.state).toHaveProperty("bout", 3);
    else expect(result.result.state).not.toHaveProperty("bout");
    expect(
      createHash("sha256")
        .update(JSON.stringify(result.result.state))
        .digest("hex"),
    ).toBe(fixture.stateHash);
    expect(verifyRealtimeReplay(fixture.replay, resolve)).toEqual(result);
    if (fixture.dropCheckpoint) {
      const checkpoint = fixture.dropCheckpoint;
      const partial = verifyRealtimeReplay(
        {
          header: fixture.replay.header,
          events: fixture.replay.events.filter(
            (event) => event.tick < checkpoint.tick,
          ),
          finalTick: checkpoint.tick,
          recordedRngCursor: null,
          recordedOutcome: null,
        },
        resolve,
      );
      expect(partial.ok).toBe(true);
      if (!partial.ok) throw new Error(partial.code);
      const view = bombermanDefinition.projectView({
        state: partial.result.state as ReturnType<
          typeof bombermanDefinition.createInitialState
        >["state"],
        viewer: { kind: "player", slotId: "p0" },
      });
      expect(view.players).toMatchObject(checkpoint.players);
      expect(view.pickups).toEqual(checkpoint.pickups);
      expect(view.pickups).not.toHaveLength(0);
    }
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
