import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveRealtimeGameDefinition } from "@online-game-hub/game-registry/server";
import { projectMatchHistoryResult } from "@online-game-hub/game-registry/history";
import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
  verifyRealtimeReplay,
  type RealtimeCanonicalReplay,
} from "@online-game-hub/realtime-game-sdk";
import type { RealtimeStoredRoom } from "@online-game-hub/realtime-game-server-runtime";
import {
  createPostgresDatabaseClient,
  PostgresRealtimeRoomStore,
  PostgresRealtimeReplayStore,
  PostgresRealtimeMatchArchive,
  PostgresRealtimeMatchRepository,
} from "../src/index.js";
import { users } from "../src/schema.js";
import {
  createIsolatedTestDatabase,
  requireTestDatabaseUrl,
  type IsolatedTestDatabase,
} from "../src/testing.js";

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Missing Bomberman database fixture.");
  return value;
}
async function fixture(
  count: number,
  kind: "score" | "draw",
): Promise<RealtimeCanonicalReplay> {
  const { replay } = JSON.parse(
    await readFile(
      new URL(
        `../../../games/bomberman/tests/fixtures/bomberman-1.0.0-${count}p.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { replay: RealtimeCanonicalReplay };
  if (kind === "score") return replay;
  const definition = required(
    resolveRealtimeGameDefinition("bomberman", "1.0.0"),
  );
  const rng = createRealtimeRng(`bomberman-draw-${count}`);
  const header = {
    ...replay.header,
    rng: { algorithm: rng.algorithm, seed: rng.seed },
  };
  const participants = header.players.map((player) =>
    defineRealtimePlayerSlotId(player.slotId),
  );
  const initial = definition.createInitialState({
    config: header.initialConfig,
    players: participants,
    rng,
  });
  const result = definition.step({
    ...initial,
    tick: 0,
    inputs: participants.map((slotId) => ({
      slotId,
      input: { type: "RESIGN" },
    })),
  });
  return {
    header,
    events: participants.map((actorSlotId, index) => ({
      sequence: index + 1,
      tick: 0,
      actorSlotId,
      input: { type: "RESIGN" },
    })),
    finalTick: 1,
    recordedRngCursor: result.rng.cursor,
    recordedOutcome: definition.getOutcome(result.state),
  };
}

describe.sequential("Bomberman PostgreSQL archives and private results", () => {
  let isolated: IsolatedTestDatabase;
  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(
      requireTestDatabaseUrl(process.env),
    );
  });
  afterAll(async () => {
    await isolated?.close();
  });
  for (const count of [2, 3, 4])
    for (const kind of ["score", "draw"] as const) {
      it(`rereads an exact ${count}-player ${kind} record and account-isolated outcomes`, async () => {
        const replay = await fixture(count, kind);
        expect(
          verifyRealtimeReplay(replay, resolveRealtimeGameDefinition).ok,
        ).toBe(true);
        const ids = Array.from({ length: count }, () => randomUUID()),
          outsider = randomUUID();
        await isolated.client.database
          .insert(users)
          .values([...ids, outsider].map((id) => ({ id, displayName: id })));
        const options = { resolveDefinition: resolveRealtimeGameDefinition };
        const replays = new PostgresRealtimeReplayStore(
          isolated.client.database,
          options,
        );
        const rooms = new PostgresRealtimeRoomStore(isolated.client.database);
        const archive = new PostgresRealtimeMatchArchive(
          isolated.client.database,
          options,
        );
        const replayId = randomUUID(),
          roomId = randomUUID();
        const order = replay.header.players.map((player) => player.slotId);
        const config = replay.header.initialConfig;
        const setup = {
          config,
          participantSlotIds: order,
          playerOrder: order,
          assignments: order.map((slotId, index) => ({
            slotId,
            assignment: String(index),
          })),
        };
        const active: RealtimeStoredRoom = {
          roomId,
          roomCode: `BMBR23${count}${kind === "score" ? 4 : 5}`,
          gameId: "bomberman",
          gameVersion: "1.0.0",
          setupProtocol: 6,
          initialConfig: config,
          players: Array.from({ length: 4 }, (_, index) => ({
            slotId: `p${index}`,
            playerSessionId:
              index < count ? `bomberman-session-${index}` : null,
            userId: ids[index] ?? null,
            reservedUntilMilliseconds: null,
          })),
          previousFinalizedSetup: setup,
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
        await replays.create(replayId, replay.header);
        await rooms.create(active);
        await archive.createRound(active);
        await archive.createRound(active);
        for (const event of replay.events) {
          await replays.append(replayId, event.sequence - 1, event);
          await replays.append(replayId, event.sequence - 1, event);
        }
        const invalid = {
          sequence: replay.events.length + 1,
          tick: replay.finalTick,
          actorSlotId: "outsider",
          input: { type: "PLACE_BOMB" },
        };
        await expect(
          replays.append(replayId, replay.events.length, invalid),
        ).rejects.toThrow();
        expect((await replays.get(replayId))?.events).toEqual(replay.events);
        const outcome = required(replay.recordedOutcome),
          cursor = required(replay.recordedRngCursor);
        await replays.complete(
          replayId,
          replay.events.length,
          replay.finalTick,
          cursor,
          outcome,
        );
        await replays.complete(
          replayId,
          replay.events.length,
          replay.finalTick,
          cursor,
          outcome,
        );
        const completed: RealtimeStoredRoom = {
          ...active,
          currentRound: {
            ...required(active.currentRound),
            tick: replay.finalTick,
            status: "completed",
            outcome,
          },
          nextRoundSetup: {
            schemaVersion: 1,
            setupState: { config },
            setupRevision: 0,
            setupRng: createRealtimeRng(`setup-${roomId}`),
            readySlotIds: [],
            finalizedSetup: null,
          },
        };
        await rooms.save(completed);
        await archive.saveRound(completed);
        await archive.saveRound(completed);
        const reader = createPostgresDatabaseClient({
          url: isolated.url,
          applicationName: "bomberman-archive-reread",
          maxConnections: 1,
        });
        try {
          const stored = await new PostgresRealtimeRoomStore(
            reader.database,
          ).getByRoomCode(active.roomCode);
          expect(stored).toEqual(completed);
          const readReplay = await new PostgresRealtimeReplayStore(
            reader.database,
            options,
          ).get(replayId);
          expect(readReplay).toEqual(replay);
          expect(
            verifyRealtimeReplay(readReplay, resolveRealtimeGameDefinition).ok,
          ).toBe(true);
          const history = new PostgresRealtimeMatchRepository(reader.database);
          expect(await history.listForUserWithResults(outsider)).toEqual([]);
          for (const [index, id] of ids.entries()) {
            const rows = await history.listForUserWithResults(id);
            expect(rows).toHaveLength(1);
            const row = required(rows[0]);
            expect(row).toMatchObject({
              gameId: "bomberman",
              gameVersion: "1.0.0",
              status: "completed",
              playerSlotId: `p${index}`,
            });
            expect(projectMatchHistoryResult(row)).toEqual({
              kind: "win-loss",
              value:
                kind === "draw" ? "draw" : index === count - 1 ? "win" : "loss",
            });
            const metadata = await history.listForUser(id);
            expect(metadata).toHaveLength(1);
            for (const privateKey of [
              "rng",
              "seed",
              "recordedOutcome",
              "players",
              "hiddenPickups",
              "playerSessionId",
            ])
              expect(JSON.stringify(metadata)).not.toContain(`"${privateKey}"`);
          }
        } finally {
          await reader.close();
        }
      });
    }
});
