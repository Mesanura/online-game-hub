import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  eraseRealtimeGameDefinition,
  verifyRealtimeReplay,
} from "@online-game-hub/realtime-game-sdk";
import {
  tankMazeDefinition,
  tankMazeDefinitionV1_0_0,
  tankMazeDefinitionV1_1_0,
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
  [tankMazeDefinitionV1_0_0, tankMazeDefinitionV1_1_0, tankMazeDefinition]
    .map(eraseRealtimeGameDefinition)
    .find(
      (game) =>
        game.manifest.id === id && game.manifest.gameVersion === version,
    );
describe.each(["1.0.0", "1.1.0", "1.2.0"])("tank maze %s golden", (version) => {
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
          state: { bout: 2, phase: "COMPLETE" },
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
      expect(
        verifyRealtimeReplay(
          {
            ...record,
            recordedOutcome: { ...record.recordedOutcome, winnerSlotId: "p0" },
          },
          resolve,
        ),
      ).toMatchObject({ ok: false, code: "OUTCOME_MISMATCH" });
    },
  );
});

it("rebuilds the 1.2.0 forward, reverse and stop events before the first map reset", () => {
  const record = fixture("1.2.0");
  for (const [finalTick, x, y] of [
    [181, 350000, 150000],
    [190, 367847, 147651],
    [195, 357932, 148956],
    [196, 357932, 148956],
  ] as const) {
    expect(
      verifyRealtimeReplay(
        {
          ...record,
          events: record.events.filter(
            (event: { tick: number }) => event.tick < finalTick,
          ),
          finalTick,
          recordedOutcome: null,
          recordedRngCursor: null,
        },
        resolve,
      ),
    ).toMatchObject({
      ok: true,
      result: {
        state: {
          arena: { cols: 6, rows: 5 },
          tanks: expect.arrayContaining([
            expect.objectContaining({ slotId: "p7", x, y }),
          ]),
        },
      },
    });
  }
});
