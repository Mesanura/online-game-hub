import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
  eraseRealtimeGameDefinition,
  verifyRealtimeReplay,
  type RealtimeCanonicalReplay,
} from "@online-game-hub/realtime-game-sdk";
import { describe, expect, it } from "vitest";

import {
  badmintonDefinition,
  badmintonDefinitionV1_0_0,
  badmintonDefinitionV1_1_0,
  badmintonDefinitionV1_2_0,
} from "../src/core/index.js";

const resolve = (gameId: string, gameVersion: string) =>
  gameId === "badminton" && gameVersion === "1.0.0"
    ? eraseRealtimeGameDefinition(badmintonDefinitionV1_0_0)
    : gameId === "badminton" && gameVersion === "1.1.0"
      ? eraseRealtimeGameDefinition(badmintonDefinitionV1_1_0)
      : gameId === "badminton" && gameVersion === "1.2.0"
        ? eraseRealtimeGameDefinition(badmintonDefinitionV1_2_0)
        : gameId === "badminton" && gameVersion === "1.3.0"
          ? eraseRealtimeGameDefinition(badmintonDefinition)
          : undefined;
const fixture = (name: string, version = "1.0.0") =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/badminton-${version}-${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as RealtimeCanonicalReplay;

describe("badminton exact realtime golden records", () => {
  it.each([
    [
      "score",
      "149d79f5e62bc657c9743265d5c34f6f6335db38a57ababcfa48d5ed546470b9",
    ],
    [
      "rally",
      "1b96cd54ba0cd2b2688ba4e965e8fdbed4d7b10ca8c5a95b288e5237ccd5bbb6",
    ],
  ] as const)(
    "rebuilds the 1.3.0 %s record with a frozen trajectory at every tick",
    (name, digest) => {
      const replay = fixture(name, "1.3.0");
      const verified = verifyRealtimeReplay(replay, resolve);
      expect(verified.ok).toBe(true);
      if (!verified.ok)
        throw new Error("Current badminton golden did not verify.");
      let current = badmintonDefinition.createInitialState({
        config: badmintonDefinition.configSchema.parse(
          replay.header.initialConfig,
        ),
        players: replay.header.players.map((player) =>
          defineRealtimePlayerSlotId(player.slotId),
        ),
        rng: createRealtimeRng(replay.header.rng.seed),
      });
      let serialized = current;
      const trace = createHash("sha256");
      const shots = new Set<string>();
      for (let tick = 0; tick < replay.finalTick; tick++) {
        const inputs = replay.events
          .filter((event) => event.tick === tick)
          .map((event) => ({
            slotId: defineRealtimePlayerSlotId(event.actorSlotId),
            input: badmintonDefinition.inputSchema.parse(event.input),
          }));
        current = badmintonDefinition.step({ ...current, tick, inputs });
        serialized = badmintonDefinition.step({
          ...JSON.parse(JSON.stringify(serialized)),
          tick,
          inputs,
        });
        expect(serialized).toEqual(current);
        trace.update(JSON.stringify(current.state));
        for (const athlete of current.state.athletes)
          if (athlete.lastContact?.tick === current.state.tick)
            shots.add(athlete.lastContact.shot);
      }
      expect(trace.digest("hex")).toBe(digest);
      expect(current.state).toEqual(verified.result.state);
      expect(current.rng.cursor).toBe(0);
      if (name === "rally") {
        expect([...shots].sort()).toEqual(["CLEAR", "DROP", "SMASH"]);
        expect(current.state.bestRally).toBe(9);
      } else {
        expect(current.state.scores).toEqual([7, 0]);
        expect(
          verifyRealtimeReplay(
            { ...replay, header: { ...replay.header, gameVersion: "1.2.0" } },
            resolve,
          ).ok,
        ).toBe(false);
      }
    },
  );

  it("reconstructs the frozen 1.2.0 journal with its exact definition", () => {
    const replay = fixture("resignation", "1.2.0");
    const result = verifyRealtimeReplay(replay, resolve);
    expect(result).toMatchObject({
      ok: true,
      result: {
        finalTick: 41,
        outcome: replay.recordedOutcome,
        rng: { cursor: 0 },
      },
    });
    expect(verifyRealtimeReplay(replay, resolve)).toEqual(result);
  });
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
  it.each(["score", "resignation", "rally"])(
    "rebuilds the manually served 1.1.0 %s record",
    (name) => {
      const replay = fixture(name, "1.1.0");
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
      expect(
        verifyRealtimeReplay(
          { ...replay, header: { ...replay.header, gameVersion: "1.0.0" } },
          resolve,
        ).ok,
      ).toBe(false);
    },
  );
});
