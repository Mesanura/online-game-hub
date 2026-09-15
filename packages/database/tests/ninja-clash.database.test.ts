import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveRealtimeGameDefinition } from "@online-game-hub/game-registry/server";
import { projectMatchHistoryResult } from "@online-game-hub/game-registry/history";
import {
  verifyRealtimeReplay,
  type RealtimeCanonicalReplay,
} from "@online-game-hub/realtime-game-sdk";
import type { RealtimeStoredRoom } from "@online-game-hub/realtime-game-server-runtime";
import {
  createPostgresDatabaseClient,
  PostgresRealtimeReplayStore,
  PostgresRealtimeRoomStore,
  PostgresRealtimeMatchArchive,
  PostgresRealtimeMatchRepository,
} from "../src/index.js";
import { users } from "../src/schema.js";
import {
  createIsolatedTestDatabase,
  requireTestDatabaseUrl,
  type IsolatedTestDatabase,
} from "../src/testing.js";
describe.sequential("Ninja Clash PostgreSQL archives", () => {
  let isolated: IsolatedTestDatabase;
  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(
      requireTestDatabaseUrl(process.env),
    );
  });
  afterAll(async () => {
    await isolated?.close();
  });
  it.each([2, 3, 4])(
    "rereads exact %i-player combat and private history",
    async (count) => {
      const { replay } = JSON.parse(
        readFileSync(
          new URL(
            `../../../games/ninja-clash/tests/fixtures/ninja-clash-1.0.0-${count}p.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ) as { replay: RealtimeCanonicalReplay };
      const ids = Array.from({ length: count + 1 }, () => randomUUID());
      await isolated.client.database
        .insert(users)
        .values(ids.map((id) => ({ id, displayName: id })));
      const options = { resolveDefinition: resolveRealtimeGameDefinition },
        replays = new PostgresRealtimeReplayStore(
          isolated.client.database,
          options,
        ),
        rooms = new PostgresRealtimeRoomStore(isolated.client.database),
        archive = new PostgresRealtimeMatchArchive(
          isolated.client.database,
          options,
        );
      const replayId = randomUUID(),
        order = replay.header.players.map((p) => p.slotId),
        config = replay.header.initialConfig;
      const active: RealtimeStoredRoom = {
        roomId: randomUUID(),
        roomCode: `NNJA234${count}`,
        gameId: "ninja-clash",
        gameVersion: "1.0.0",
        setupProtocol: 6,
        initialConfig: config,
        players: Array.from({ length: 4 }, (_, i) => ({
          slotId: "p" + i,
          playerSessionId: i < count ? "ninja-session-" + i : null,
          userId: i < count ? required(ids[i]) : null,
          reservedUntilMilliseconds: null,
        })),
        previousFinalizedSetup: {
          config,
          participantSlotIds: order,
          playerOrder: order,
          assignments: order.map((slotId, i) => ({
            slotId,
            assignment: String(i),
          })),
        },
        currentRound: {
          roundNumber: 1,
          replayId,
          playerOrder: order,
          tick: 0,
          status: "active",
          outcome: null,
        },
        closeReason: null,
      };
      await replays.create(replayId, replay.header);
      await rooms.create(active);
      await archive.createRound(active);
      for (const e of replay.events)
        await replays.append(replayId, e.sequence - 1, e);
      const last = required(replay.events.at(-1));
      await replays.append(replayId, last.sequence - 1, last);
      await expect(
        replays.append(replayId, last.sequence, {
          sequence: last.sequence + 1,
          tick: replay.finalTick,
          actorSlotId: "outsider",
          input: { type: "ATTACK" },
        }),
      ).rejects.toThrow();
      await replays.complete(
        replayId,
        replay.events.length,
        replay.finalTick,
        required(replay.recordedRngCursor),
        required(replay.recordedOutcome),
      );
      const completed: RealtimeStoredRoom = {
        ...active,
        nextRoundSetup: {
          schemaVersion: 1,
          setupState: { config },
          setupRevision: 0,
          setupRng: {
            algorithm: "fnv1a32-counter-v1",
            seed: "ninja-next",
            cursor: 0,
          },
          readySlotIds: [],
          finalizedSetup: null,
        },
        currentRound: {
          ...required(active.currentRound),
          status: "completed",
          tick: replay.finalTick,
          outcome: required(replay.recordedOutcome),
        },
      };
      await rooms.save(completed);
      await archive.saveRound(completed);
      const reader = createPostgresDatabaseClient({
        url: isolated.url,
        applicationName: "ninja-reread",
        maxConnections: 1,
      });
      try {
        const record = await new PostgresRealtimeReplayStore(
          reader.database,
          options,
        ).get(replayId);
        expect(record).toEqual(replay);
        expect(
          verifyRealtimeReplay(record, resolveRealtimeGameDefinition).ok,
        ).toBe(true);
        expect(
          await new PostgresRealtimeRoomStore(reader.database).getByRoomCode(
            active.roomCode,
          ),
        ).toEqual(completed);
        const history = new PostgresRealtimeMatchRepository(reader.database);
        expect(
          await history.listForUserWithResults(required(ids[count])),
        ).toEqual([]);
        for (let i = 0; i < count; i++) {
          const rows = await history.listForUserWithResults(required(ids[i]));
          expect(rows).toHaveLength(1);
          expect(projectMatchHistoryResult(required(rows[0]))).toEqual({
            kind: "win-loss",
            value: i === 0 ? "win" : "loss",
          });
          const metadata = JSON.stringify(
            await history.listForUser(required(ids[i])),
          );
          for (const field of [
            "seed",
            "recordedOutcome",
            "playerSessionId",
            "players",
          ])
            expect(metadata).not.toContain('"' + field + '"');
        }
      } finally {
        await reader.close();
      }
    },
  );
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected value to be present");
  return value;
}
