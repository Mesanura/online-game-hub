import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  eraseRealtimeGameDefinition,
  verifyRealtimeReplay,
} from "@online-game-hub/realtime-game-sdk";
import {
  tankMazeDefinition,
  tankMazeDefinitionV1_0_0,
} from "../src/core/index.js";
// Each full replay simulates 8,001 ticks; allow shared CI runners enough time
// for repeated reconstruction without weakening the golden assertions.
const replayTestOptions = { timeout: 30_000 };
const fixture = (version: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `./fixtures/tank-maze-${version}-multiplayer.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const resolve = (id: string, version: string) =>
  [tankMazeDefinitionV1_0_0, tankMazeDefinition]
    .map(eraseRealtimeGameDefinition)
    .find(
      (game) =>
        game.manifest.id === id && game.manifest.gameVersion === version,
    );
describe.each(["1.0.0", "1.1.0"])("tank maze %s golden", (version) => {
  it(
    "rebuilds eight participants, repeated same-tick fire and multiple maps",
    replayTestOptions,
    () => {
      const record = fixture(version),
        a = verifyRealtimeReplay(record, resolve);
      expect(a).toMatchObject({
        ok: true,
        result: {
          finalTick: 8001,
          outcome: record.recordedOutcome,
          rng: { cursor: record.recordedRngCursor },
        },
      });
      expect(verifyRealtimeReplay(record, resolve)).toEqual(a);
    },
  );
  it(
    "rejects forged actors, outcomes and invalid participant counts",
    replayTestOptions,
    () => {
      const record = fixture(version);
      expect(
        verifyRealtimeReplay(
          {
            ...record,
            header: {
              ...record.header,
              players: record.header.players.slice(0, 1),
            },
          },
          resolve,
        ).ok,
      ).toBe(false);
      expect(
        verifyRealtimeReplay(
          {
            ...record,
            events: record.events.map((e: object) => ({
              ...e,
              actorSlotId: "outsider",
            })),
          },
          resolve,
        ).ok,
      ).toBe(false);
      expect(
        verifyRealtimeReplay(
          { ...record, recordedRngCursor: record.recordedRngCursor + 1 },
          resolve,
        ).ok,
      ).toBe(false);
    },
  );
});
