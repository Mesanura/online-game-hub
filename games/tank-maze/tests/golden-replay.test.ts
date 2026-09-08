import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import {
  eraseRealtimeGameDefinition,
  verifyRealtimeReplay,
} from "@online-game-hub/realtime-game-sdk";
import { tankMazeDefinition } from "../src/core/index.js";
// Each full replay simulates 8,001 ticks; allow shared CI runners enough time
// for repeated reconstruction without weakening the golden assertions.
const replayTestOptions = { timeout: 30_000 };
const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL("./fixtures/tank-maze-1.0.0-multiplayer.json", import.meta.url),
      "utf8",
    ),
  );
const resolve = (id: string, version: string) =>
  id === "tank-maze" && version === "1.0.0"
    ? eraseRealtimeGameDefinition(tankMazeDefinition)
    : undefined;
it(
  "rebuilds eight participants, repeated same-tick fire and multiple maps",
  replayTestOptions,
  () => {
    const record = fixture(),
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
    const record = fixture();
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
