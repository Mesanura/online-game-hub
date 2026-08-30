import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { RNG_ALGORITHM_V1, createRng } from "@online-game-hub/game-sdk";
import {
  InMemoryRoomStore,
  REPLAY_FORMAT_VERSION,
  verifyReplay,
} from "@online-game-hub/game-server-runtime";
import type {
  ReplayAction,
  ReplayHeader,
  StoredGameRoom,
} from "@online-game-hub/game-server-runtime";
import { resolveGameDefinition } from "@online-game-hub/game-registry/server";

import {
  PostgresMatchArchiveRoomStore,
  PostgresMatchRepository,
  PostgresReplayStore,
  PostgresUserRepository,
  applyDatabaseMigrations,
  createPostgresDatabaseClient,
} from "../src/index.js";
import type { DatabaseError, GuestAssociationError } from "../src/index.js";
import {
  createIsolatedTestDatabase,
  requireTestDatabaseUrl,
} from "../src/testing.js";
import type { IsolatedTestDatabase } from "../src/testing.js";
import { replays } from "../src/schema.js";

const header = {
  replayFormatVersion: REPLAY_FORMAT_VERSION,
  gameId: "tic-tac-toe",
  gameVersion: "1.0.0",
  rng: {
    algorithm: RNG_ALGORITHM_V1,
    seed: "database-replay-seed",
  },
  initialConfig: null,
  players: [{ slotId: "slot-1" }, { slotId: "slot-2" }],
} as const satisfies ReplayHeader;

const winningActions = [
  {
    sequence: 1,
    actorSlotId: "slot-1",
    action: { type: "PLACE_MARK", cell: 0 },
  },
  {
    sequence: 2,
    actorSlotId: "slot-2",
    action: { type: "PLACE_MARK", cell: 3 },
  },
  {
    sequence: 3,
    actorSlotId: "slot-1",
    action: { type: "PLACE_MARK", cell: 1 },
  },
  {
    sequence: 4,
    actorSlotId: "slot-2",
    action: { type: "PLACE_MARK", cell: 4 },
  },
  {
    sequence: 5,
    actorSlotId: "slot-1",
    action: { type: "PLACE_MARK", cell: 2 },
  },
] as const satisfies readonly ReplayAction[];

const winningOutcome = {
  type: "WIN",
  winnerSlotId: "slot-1",
  winningCells: [0, 1, 2],
} as const;

function roomRecord(
  roomId: string,
  roomCode: string,
  replayId: string,
  firstSession: string,
): StoredGameRoom {
  return {
    roomId,
    roomCode,
    roundNumber: 1,
    gameId: "tic-tac-toe",
    gameVersion: "1.0.0",
    initialConfig: null,
    players: [
      {
        slotId: "slot-1",
        playerSessionId: firstSession,
        reservedUntilMilliseconds: null,
      },
      {
        slotId: "slot-2",
        playerSessionId: null,
        reservedUntilMilliseconds: null,
      },
    ],
    state: {
      players: ["slot-1", "slot-2"],
      board: [null, null, null, null, null, null, null, null, null],
      nextPlayerIndex: 0,
    },
    rng: createRng("database-replay-seed"),
    revision: 0,
    status: "waiting",
    outcome: null,
    replayId,
  };
}

describe.sequential("PostgreSQL + Drizzle persistence", () => {
  let isolated: IsolatedTestDatabase;
  let replayStore: PostgresReplayStore;
  let matchRepository: PostgresMatchRepository;
  let roomStore: PostgresMatchArchiveRoomStore;
  let userRepository: PostgresUserRepository;
  let completedMatchId: string;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(
      requireTestDatabaseUrl(process.env),
    );
    replayStore = new PostgresReplayStore(isolated.client.database);
    matchRepository = new PostgresMatchRepository(isolated.client.database);
    roomStore = new PostgresMatchArchiveRoomStore(
      matchRepository,
      new InMemoryRoomStore(),
    );
    userRepository = new PostgresUserRepository(isolated.client.database);
  }, 120_000);

  afterAll(async () => {
    await isolated?.close();
  }, 120_000);

  it("applies all migrations to an empty database and is idempotent", async () => {
    await applyDatabaseMigrations(isolated.client);
    const rows = await isolated.client.database.execute(
      sql<{ readonly table_name: string }>`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
        order by table_name
      `,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      "guest_user_associations",
      "match_players",
      "matches",
      "replay_actions",
      "replays",
      "users",
    ]);
  });

  it("persists replay create/append/complete across new connections", async () => {
    await replayStore.create("replay-cross-connection", header);
    await replayStore.create("replay-cross-connection", header);
    await replayStore.append("replay-cross-connection", 0, winningActions[0]);

    const secondClient = createPostgresDatabaseClient({
      url: isolated.url,
      applicationName: "database-integration-second-connection",
      maxConnections: 2,
    });
    try {
      const rebuiltStore = new PostgresReplayStore(secondClient.database);
      await rebuiltStore.append(
        "replay-cross-connection",
        0,
        winningActions[0],
      );
      for (const action of winningActions.slice(1)) {
        await rebuiltStore.append(
          "replay-cross-connection",
          action.sequence - 1,
          action,
        );
      }
      await rebuiltStore.complete(
        "replay-cross-connection",
        5,
        0,
        winningOutcome,
      );
      await rebuiltStore.complete(
        "replay-cross-connection",
        5,
        0,
        winningOutcome,
      );
      const replay = await rebuiltStore.get("replay-cross-connection");
      expect(replay?.actions).toEqual(winningActions);
      expect(verifyReplay(replay, resolveGameDefinition)).toMatchObject({
        status: "verified",
        outcome: winningOutcome,
        rng: { cursor: 0 },
      });
    } finally {
      await secondClient.close();
    }
  });

  it("fails closed on gaps, conflicts, concurrent append, and completion conflict", async () => {
    await replayStore.create("replay-concurrency", header);
    await expect(
      replayStore.append("replay-concurrency", 0, {
        ...winningActions[0],
        sequence: 2,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SEQUENCE" });

    const first = {
      ...winningActions[0],
      action: { type: "PLACE_MARK", cell: 0 },
    } as const;
    const conflicting = {
      ...winningActions[0],
      action: { type: "PLACE_MARK", cell: 1 },
    } as const;
    const results = await Promise.allSettled([
      replayStore.append("replay-concurrency", 0, first),
      replayStore.append("replay-concurrency", 0, conflicting),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const persisted = await replayStore.get("replay-concurrency");
    expect(persisted?.actions).toHaveLength(1);
    const persistedAction = persisted?.actions[0];
    if (persistedAction === undefined) {
      throw new Error("Concurrent append did not persist one action.");
    }
    await expect(
      replayStore.append("replay-concurrency", 0, persistedAction),
    ).resolves.toBeUndefined();
    await replayStore.complete("replay-concurrency", 1, 0, { type: "DRAW" });
    await expect(
      replayStore.complete("replay-concurrency", 1, 1, { type: "DRAW" }),
    ).rejects.toMatchObject({ code: "COMPLETION_CONFLICT" });
    await expect(
      replayStore.append("replay-concurrency", 1, {
        sequence: 2,
        actorSlotId: "slot-2",
        action: { type: "PLACE_MARK", cell: 4 },
      }),
    ).rejects.toMatchObject({ code: "REPLAY_ALREADY_COMPLETED" });
  });

  it("archives completed and abandoned matches with private stable history", async () => {
    await replayStore.create("replay-completed-match", header);
    const waiting = roomRecord(
      "runtime-completed",
      "HJST2345",
      "replay-completed-match",
      "guest-history-a",
    );
    await roomStore.create(waiting);
    const [firstPlayer, secondPlayer] = waiting.players;
    if (firstPlayer === undefined || secondPlayer === undefined) {
      throw new Error("Expected two preallocated player slots.");
    }
    const active: StoredGameRoom = {
      ...waiting,
      status: "active",
      players: [
        firstPlayer,
        {
          ...secondPlayer,
          playerSessionId: "guest-history-b",
        },
      ],
    };
    await roomStore.save(active);
    for (const action of winningActions) {
      await replayStore.append(active.replayId, action.sequence - 1, action);
    }
    await replayStore.complete(active.replayId, 5, 0, winningOutcome);
    await roomStore.save({
      ...active,
      revision: 5,
      status: "completed",
      outcome: winningOutcome,
    });

    const historyA = await matchRepository.listForGuest("guest-history-a");
    const historyB = await matchRepository.listForGuest("guest-history-b");
    expect(historyA[0]).toMatchObject({
      gameId: "tic-tac-toe",
      gameVersion: "1.0.0",
      status: "completed",
      finalRevision: 5,
      playerSlotId: "slot-1",
      replayAvailable: true,
    });
    expect(historyB[0]).toMatchObject({
      matchId: historyA[0]?.matchId,
      playerSlotId: "slot-2",
    });
    completedMatchId = historyA[0]?.matchId ?? "";

    await replayStore.create("replay-abandoned-match", header);
    const abandonedWaiting = roomRecord(
      "runtime-abandoned",
      "ABND2345",
      "replay-abandoned-match",
      "guest-history-a",
    );
    await roomStore.create(abandonedWaiting);
    await roomStore.save({
      ...abandonedWaiting,
      status: "abandoned",
    });
    const historyAfterAbandon =
      await matchRepository.listForGuest("guest-history-a");
    expect(historyAfterAbandon).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "abandoned",
          finalRevision: 0,
          replayAvailable: false,
        }),
        expect.objectContaining({
          status: "completed",
          finalRevision: 5,
        }),
      ]),
    );
  });

  it("archives consecutive rounds in one runtime room with independent replay and history", async () => {
    await replayStore.create("replay-round-one", header);
    const waiting = roomRecord(
      "runtime-multi-round",
      "RUND2345",
      "replay-round-one",
      "guest-round-a",
    );
    await roomStore.create(waiting);
    const [firstPlayer, secondPlayer] = waiting.players;
    if (firstPlayer === undefined || secondPlayer === undefined) {
      throw new Error("Expected two preallocated player slots.");
    }
    const activeRoundOne: StoredGameRoom = {
      ...waiting,
      status: "active",
      players: [
        firstPlayer,
        { ...secondPlayer, playerSessionId: "guest-round-b" },
      ],
    };
    await roomStore.save(activeRoundOne);
    for (const action of winningActions) {
      await replayStore.append(
        activeRoundOne.replayId,
        action.sequence - 1,
        action,
      );
    }
    await replayStore.complete(activeRoundOne.replayId, 5, 0, winningOutcome);
    await roomStore.save({
      ...activeRoundOne,
      revision: 5,
      status: "completed",
      outcome: winningOutcome,
    });

    const roundTwoHeader: ReplayHeader = {
      ...header,
      rng: { ...header.rng, seed: "database-replay-round-two-seed" },
    };
    await replayStore.create("replay-round-two", roundTwoHeader);
    const activeRoundTwo: StoredGameRoom = {
      ...activeRoundOne,
      roundNumber: 2,
      replayId: "replay-round-two",
      state: waiting.state,
      rng: createRng(roundTwoHeader.rng.seed),
      revision: 0,
      status: "active",
      outcome: null,
    };
    await roomStore.save(activeRoundTwo);
    for (const action of winningActions) {
      await replayStore.append(
        activeRoundTwo.replayId,
        action.sequence - 1,
        action,
      );
    }
    await replayStore.complete(activeRoundTwo.replayId, 5, 0, winningOutcome);
    await roomStore.save({
      ...activeRoundTwo,
      revision: 5,
      status: "completed",
      outcome: winningOutcome,
    });

    const history = await matchRepository.listForGuest("guest-round-a");
    expect(history).toHaveLength(2);
    expect(history.map((item) => item.roundNumber).sort()).toEqual([1, 2]);
    expect(new Set(history.map((item) => item.matchId)).size).toBe(2);
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roundNumber: 1,
          status: "completed",
          replayAvailable: true,
        }),
        expect.objectContaining({
          roundNumber: 2,
          status: "completed",
          replayAvailable: true,
        }),
      ]),
    );

    await replayStore.create("replay-skipped-round", roundTwoHeader);
    await expect(
      roomStore.save({
        ...activeRoundTwo,
        roundNumber: 4,
        replayId: "replay-skipped-round",
      }),
    ).rejects.toMatchObject({ code: "DATABASE_OPERATION_ERROR" });

    const rebuiltClient = createPostgresDatabaseClient({
      url: isolated.url,
      applicationName: "database-integration-multi-round-rebuild",
      maxConnections: 2,
    });
    try {
      const rebuiltMatches = new PostgresMatchRepository(
        rebuiltClient.database,
      );
      await expect(
        rebuiltMatches.listForGuest("guest-round-a"),
      ).resolves.toEqual(history);
      const rebuiltReplay = await new PostgresReplayStore(
        rebuiltClient.database,
      ).get("replay-round-two");
      expect(verifyReplay(rebuiltReplay, resolveGameDefinition)).toMatchObject({
        status: "verified",
      });
    } finally {
      await rebuiltClient.close();
    }
  });

  it("rebuilds history after adapter reconstruction and enforces guest ownership", async () => {
    await replayStore.create("replay-private-match", header);
    const privateWaiting = roomRecord(
      "runtime-private",
      "PRJV2345",
      "replay-private-match",
      "guest-private",
    );
    await roomStore.create(privateWaiting);
    await roomStore.save({ ...privateWaiting, status: "abandoned" });
    const privateHistory = await matchRepository.listForGuest("guest-private");
    const privateMatchId = privateHistory[0]?.matchId;
    if (privateMatchId === undefined) {
      throw new Error("Private history match was not archived.");
    }

    const rebuiltClient = createPostgresDatabaseClient({
      url: isolated.url,
      applicationName: "database-integration-rebuilt-adapter",
      maxConnections: 2,
    });
    try {
      const rebuiltMatches = new PostgresMatchRepository(
        rebuiltClient.database,
      );
      const rebuiltReplays = new PostgresReplayStore(rebuiltClient.database);
      await expect(
        rebuiltMatches.getForGuest("guest-history-a", privateMatchId),
      ).resolves.toBeNull();
      await expect(
        rebuiltMatches.getForGuest("guest-private", privateMatchId),
      ).resolves.toMatchObject({ status: "abandoned" });
      const completedReplay = await rebuiltReplays.get(
        "replay-completed-match",
      );
      expect(
        verifyReplay(completedReplay, resolveGameDefinition),
      ).toMatchObject({ status: "verified" });
    } finally {
      await rebuiltClient.close();
    }
  });

  it("associates guest history transactionally and prevents cross-user takeover", async () => {
    const userA = await userRepository.createUser();
    const userB = await userRepository.createUser();
    await userRepository.associateGuestWithUser(
      "guest-history-a",
      userA.userId,
    );
    await userRepository.associateGuestWithUser(
      "guest-history-a",
      userA.userId,
    );
    await expect(
      userRepository.associateGuestWithUser("guest-history-a", userB.userId),
    ).rejects.toEqual(
      expect.objectContaining<Partial<GuestAssociationError>>({
        code: "GUEST_ASSOCIATION_CONFLICT",
      }),
    );
    await expect(
      userRepository.associateGuestWithUser(
        "guest-history-a",
        "00000000-0000-4000-8000-000000000000",
      ),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });

    const userHistory = await matchRepository.listForUser(userA.userId);
    expect(userHistory.some((item) => item.matchId === completedMatchId)).toBe(
      true,
    );
    const guestHistory = await matchRepository.listForGuest("guest-history-a");
    expect(guestHistory.some((item) => item.matchId === completedMatchId)).toBe(
      true,
    );

    await replayStore.create("replay-after-association", header);
    const futureWaiting = roomRecord(
      "runtime-after-association",
      "LJNK2345",
      "replay-after-association",
      "guest-history-a",
    );
    await roomStore.create(futureWaiting);
    await roomStore.save({ ...futureWaiting, status: "abandoned" });
    const futureUserHistory = await matchRepository.listForUser(userA.userId);
    expect(
      futureUserHistory.some(
        (item) =>
          item.status === "abandoned" && item.matchId !== completedMatchId,
      ),
    ).toBe(true);
  });

  it("marks residual waiting/active archives abandoned without restoring rooms", async () => {
    await replayStore.create("replay-startup-residual", header);
    const residual = roomRecord(
      "runtime-residual",
      "LEFT2345",
      "replay-startup-residual",
      "guest-residual",
    );
    await roomStore.create(residual);
    expect(await matchRepository.abandonIncompleteMatches()).toBeGreaterThan(0);
    await expect(
      matchRepository.listForGuest("guest-residual"),
    ).resolves.toEqual([
      expect.objectContaining({
        status: "abandoned",
        replayAvailable: false,
      }),
    ]);
  });

  it("rejects corrupted database JSON with constant errors that do not leak secrets", async () => {
    await replayStore.create("replay-corrupt", header);
    await isolated.client.database
      .update(replays)
      .set({ players: [{ participantRef: "session-secret" }] })
      .where(eq(replays.id, "replay-corrupt"));
    let error: unknown;
    try {
      await replayStore.get("replay-corrupt");
    } catch (caught) {
      error = caught;
    }
    expect(error).toEqual(
      expect.objectContaining<Partial<DatabaseError>>({
        code: "DATABASE_DATA_INVALID",
        message: "DATABASE_DATA_INVALID",
      }),
    );
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("session-secret");
    expect(serialized).not.toContain("postgresql://");
    expect(serialized).not.toContain("database-replay-seed");
  });
});
