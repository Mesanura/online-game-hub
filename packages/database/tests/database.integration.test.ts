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
  StoredGameRound,
  StoredGameRoom,
} from "@online-game-hub/game-server-runtime";
import { resolveGameDefinition } from "@online-game-hub/game-registry/server";
import type { RealtimeStoredRoom } from "@online-game-hub/realtime-game-server-runtime";

import {
  PostgresAccountRepository,
  PostgresMatchArchive,
  PostgresMatchRepository,
  PostgresReplayStore,
  PostgresRealtimeReplayStore,
  PostgresRealtimeRoomStore,
  PostgresUserRepository,
  applyDatabaseMigrations,
  createPostgresDatabaseClient,
} from "../src/index.js";
import type { AccountRepositoryError, DatabaseError } from "../src/index.js";
import {
  createIsolatedTestDatabase,
  requireTestDatabaseUrl,
} from "../src/testing.js";
import type { IsolatedTestDatabase } from "../src/testing.js";
import {
  accountSessions,
  realtimeRoomPlayers,
  realtimeRooms,
  replays,
} from "../src/schema.js";

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
  firstUserId: string | null = null,
  secondUserId: string | null = null,
): StoredGameRoom {
  return {
    roomId,
    roomCode,
    gameId: "tic-tac-toe",
    gameVersion: "1.0.0",
    setupProtocol: 5,
    initialConfig: null,
    players: [
      {
        slotId: "slot-1",
        playerSessionId: firstSession,
        userId: firstUserId,
        reservedUntilMilliseconds: null,
      },
      {
        slotId: "slot-2",
        playerSessionId: `${firstSession}-opponent`,
        userId: secondUserId,
        reservedUntilMilliseconds: null,
      },
    ],
    currentRound: {
      roundNumber: 1,
      playerOrder: ["slot-1", "slot-2"],
      state: {
        players: ["slot-1", "slot-2"],
        board: [null, null, null, null, null, null, null, null, null],
        nextPlayerIndex: 0,
      },
      rng: createRng("database-replay-seed"),
      revision: 0,
      status: "active",
      outcome: null,
      replayId,
    },
    closeReason: null,
  };
}

function currentRound(room: StoredGameRoom): StoredGameRound {
  if (room.currentRound === null) {
    throw new Error("Expected an archived round.");
  }
  return room.currentRound;
}

function realtimeRoomRecord(
  roomId: string,
  roomCode: string,
  setupProtocol: 5 | 6,
): RealtimeStoredRoom {
  return {
    roomId,
    roomCode,
    gameId: "pong",
    gameVersion: "1.0.0",
    setupProtocol,
    initialConfig: { targetScore: 3 },
    players: [
      {
        slotId: "left",
        playerSessionId: "realtime-session-left",
        userId: null,
        reservedUntilMilliseconds: null,
      },
      {
        slotId: "right",
        playerSessionId: null,
        userId: null,
        reservedUntilMilliseconds: null,
      },
    ],
    currentRound: null,
    ...(setupProtocol === 6
      ? {
          nextRoundSetup: {
            schemaVersion: 1 as const,
            setupState: {
              config: { targetScore: 3 },
              starter: "UNSELECTED",
              fixedStarterSlotId: null,
            },
            setupRevision: 0,
            setupRng: {
              algorithm: "fnv1a32-counter-v1" as const,
              seed: "database-realtime-setup-seed",
              cursor: 0,
            },
            readySlotIds: [],
            finalizedSetup: null,
          },
        }
      : {}),
    closeReason: null,
  };
}

describe.sequential("PostgreSQL + Drizzle persistence", () => {
  let isolated: IsolatedTestDatabase;
  let replayStore: PostgresReplayStore;
  let accountRepository: PostgresAccountRepository;
  let matchRepository: PostgresMatchRepository;
  let roomStore: InMemoryRoomStore;
  let matchArchive: PostgresMatchArchive;
  let userRepository: PostgresUserRepository;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(
      requireTestDatabaseUrl(process.env),
    );
    replayStore = new PostgresReplayStore(isolated.client.database);
    accountRepository = new PostgresAccountRepository(isolated.client.database);
    matchRepository = new PostgresMatchRepository(isolated.client.database);
    roomStore = new InMemoryRoomStore();
    matchArchive = new PostgresMatchArchive(matchRepository);
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
      "account_sessions",
      "match_players",
      "matches",
      "password_credentials",
      "realtime_match_players",
      "realtime_matches",
      "realtime_replay_events",
      "realtime_replays",
      "realtime_room_players",
      "realtime_rooms",
      "replay_actions",
      "replays",
      "users",
    ]);
  });

  it("persists pinned realtime room generations across adapter reconstruction", async () => {
    const store = new PostgresRealtimeRoomStore(isolated.client.database);
    const v5Room = realtimeRoomRecord(
      "realtime-room-generation-v5",
      "PERS2345",
      5,
    );
    const v6Room = realtimeRoomRecord(
      "realtime-room-generation-v6",
      "PERS6789",
      6,
    );
    await store.create(v5Room);
    await store.create(v6Room);
    await store.save({
      ...v5Room,
      players: v5Room.players.map((player) =>
        player.slotId === "right"
          ? { ...player, playerSessionId: "realtime-session-right" }
          : player,
      ),
    });
    if (v6Room.nextRoundSetup === undefined) {
      throw new Error("Expected the V6 realtime setup fixture.");
    }
    await store.save({
      ...v6Room,
      players: v6Room.players.map((player) =>
        player.slotId === "right"
          ? { ...player, playerSessionId: "realtime-v6-session-right" }
          : player,
      ),
      nextRoundSetup: {
        ...v6Room.nextRoundSetup,
        setupState: {
          config: { targetScore: 3 },
          starter: "OWNER",
          fixedStarterSlotId: null,
        },
        setupRevision: 1,
        readySlotIds: ["left"],
      },
    });
    await expect(store.getByRoomCode("PERS6789")).resolves.toMatchObject({
      setupProtocol: 6,
      nextRoundSetup: {
        setupRevision: 1,
        readySlotIds: ["left"],
        setupState: { starter: "OWNER" },
        setupRng: { seed: "database-realtime-setup-seed", cursor: 0 },
      },
    });

    const finalizedSetup = {
      config: { targetScore: 3 },
      participantSlotIds: ["left", "right"],
      playerOrder: ["left", "right"],
      assignments: [
        { slotId: "left", assignment: null },
        { slotId: "right", assignment: null },
      ],
    } as const;
    const realtimeReplayStore = new PostgresRealtimeReplayStore(
      isolated.client.database,
    );
    await realtimeReplayStore.create("database-v6-room-replay", {
      replayFormatVersion: 1,
      runtime: "realtime",
      gameId: "pong",
      gameVersion: "1.0.0",
      tickRate: 60,
      rng: { algorithm: "fnv1a32-counter-v1", seed: "database-gameplay-seed" },
      initialConfig: { targetScore: 3 },
      players: [{ slotId: "left" }, { slotId: "right" }],
    });
    const setupRoom = await store.getByRoomCode("PERS6789");
    if (setupRoom === null) throw new Error("Expected the V6 realtime room.");
    const { nextRoundSetup: _nextRoundSetup, ...roomWithoutNextSetup } =
      setupRoom;
    expect(_nextRoundSetup).not.toBeNull();
    await store.save({
      ...roomWithoutNextSetup,
      previousFinalizedSetup: finalizedSetup,
      currentRound: {
        roundNumber: 1,
        replayId: "database-v6-room-replay",
        playerOrder: ["left", "right"],
        tick: 0,
        status: "active",
        outcome: null,
      },
    });
    await expect(
      store.save({ ...v5Room, setupProtocol: 6 }),
    ).rejects.toMatchObject({ code: "DATABASE_OPERATION_ERROR" });
    await expect(store.getByRoomCode(" pers2345 ")).resolves.toMatchObject({
      setupProtocol: 5,
      players: [
        expect.objectContaining({ slotId: "left" }),
        expect.objectContaining({
          slotId: "right",
          playerSessionId: "realtime-session-right",
        }),
      ],
    });

    const rebuiltClient = createPostgresDatabaseClient({
      url: isolated.url,
      applicationName: "database-integration-realtime-room-rebuild",
      maxConnections: 2,
    });
    try {
      const rebuiltStore = new PostgresRealtimeRoomStore(
        rebuiltClient.database,
      );
      await expect(
        rebuiltStore.getByRoomCode("PERS2345"),
      ).resolves.toMatchObject({ setupProtocol: 5 });
      await expect(
        rebuiltStore.getByRoomCode("PERS6789"),
      ).resolves.toMatchObject({
        setupProtocol: 6,
        previousFinalizedSetup: {
          config: { targetScore: 3 },
          playerOrder: ["left", "right"],
        },
        currentRound: { roundNumber: 1, status: "active" },
      });
    } finally {
      await rebuiltClient.close();
    }
  });

  it("defaults legacy realtime room rows to V5 and enforces the database generation constraint", async () => {
    await isolated.client.database.insert(realtimeRooms).values({
      roomId: "realtime-room-generation-default",
      roomCode: "DFLT2345",
      gameId: "pong",
      gameVersion: "1.0.0",
      initialConfig: { targetScore: 3 },
    });
    await isolated.client.database.insert(realtimeRoomPlayers).values([
      {
        roomId: "realtime-room-generation-default",
        playerSlotId: "left",
        playerSessionId: "realtime-default-left",
      },
      {
        roomId: "realtime-room-generation-default",
        playerSlotId: "right",
      },
    ]);
    const store = new PostgresRealtimeRoomStore(isolated.client.database);
    await expect(store.getByRoomCode("DFLT2345")).resolves.toMatchObject({
      setupProtocol: 5,
    });

    await expect(
      isolated.client.database.insert(realtimeRooms).values({
        roomId: "realtime-room-generation-invalid",
        roomCode: "BADG2345",
        gameId: "pong",
        gameVersion: "1.0.0",
        setupProtocol: 7,
        initialConfig: { targetScore: 3 },
      }),
    ).rejects.toThrow();
  });

  it("fails closed with a stable error when a realtime room generation is corrupted", async () => {
    const store = new PostgresRealtimeRoomStore(isolated.client.database);
    const corrupted = realtimeRoomRecord(
      "realtime-room-generation-corrupt",
      "CRPT2345",
      5,
    );
    await store.create(corrupted);
    await isolated.client.database.execute(sql`
      alter table "realtime_rooms"
      drop constraint "realtime_rooms_setup_protocol_supported",
      drop constraint "realtime_rooms_setup_state_consistent"
    `);
    try {
      await isolated.client.database
        .update(realtimeRooms)
        .set({ setupProtocol: 7 })
        .where(eq(realtimeRooms.roomId, corrupted.roomId));
      await expect(
        store.getByRoomCode(corrupted.roomCode),
      ).rejects.toMatchObject({
        code: "DATABASE_DATA_INVALID",
        message: "DATABASE_DATA_INVALID",
      });
    } finally {
      await isolated.client.database
        .update(realtimeRooms)
        .set({ setupProtocol: 5 })
        .where(eq(realtimeRooms.roomId, corrupted.roomId));
      await isolated.client.database.execute(sql`
        alter table "realtime_rooms"
        add constraint "realtime_rooms_setup_protocol_supported"
        check ("setup_protocol" in (5, 6)),
        add constraint "realtime_rooms_setup_state_consistent"
        check (
          ("setup_protocol" = 5 and "next_round_setup" is null and "previous_finalized_setup" is null)
          or
          ("setup_protocol" = 6 and (
            ("current_round_number" is null and "next_round_setup" is not null and "previous_finalized_setup" is null)
            or
            ("current_round_number" is not null and "previous_finalized_setup" is not null and (
              ("current_status" = 'completed' and "next_round_setup" is not null)
              or
              ("current_status" in ('active', 'abandoned') and "next_round_setup" is null)
            ))
          ))
        )
      `);
    }
  });

  it("backfills display names when the profile migration upgrades legacy users", async () => {
    const legacyAccount = await accountRepository.registerPasswordAccount(
      "legacy_migrated",
      "$argon2id$v=19$m=19456,t=2,p=1$legacy-hash",
      {
        tokenHash: "f".repeat(64),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    );
    const legacyGuest = await userRepository.createUser();
    const migrationRows = await isolated.client.database.execute(
      sql<{ readonly createdAt: number }>`
        select created_at as "createdAt"
        from "drizzle"."__drizzle_migrations"
        order by created_at asc
        offset 4
        limit 1
      `,
    );
    const profileMigration = migrationRows[0];
    if (profileMigration === undefined) {
      throw new Error("The profile migration journal entry is missing.");
    }
    await isolated.client.database.execute(sql`
      drop table
        "realtime_room_players",
        "realtime_rooms",
        "realtime_match_players",
        "realtime_matches",
        "realtime_replay_events",
        "realtime_replays"
    `);
    await isolated.client.database.execute(
      sql`alter table "users" drop constraint "users_display_name_length_valid"`,
    );
    await isolated.client.database.execute(
      sql`alter table "users" alter column "display_name" drop not null`,
    );
    await isolated.client.database.execute(
      sql`alter table "users" drop column "display_name"`,
    );
    await isolated.client.database.execute(
      sql`delete from "drizzle"."__drizzle_migrations" where created_at >= ${profileMigration.createdAt}`,
    );

    await applyDatabaseMigrations(isolated.client);

    const rows = await isolated.client.database.execute(
      sql<{
        readonly id: string;
        readonly displayName: string;
      }>`
        select "id", "display_name" as "displayName"
        from "users"
        where "id" in (${legacyAccount.userId}, ${legacyGuest.userId})
        order by "id"
      `,
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: legacyAccount.userId, displayName: "legacy_migrated" },
        { id: legacyGuest.userId, displayName: "游客" },
      ]),
    );
  });

  it("persists unique password accounts and hashed revocable sessions", async () => {
    const token = "raw-session-token-that-must-never-be-stored";
    const tokenHash = "a".repeat(64);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const registered = await accountRepository.registerPasswordAccount(
      "alice_123",
      "$argon2id$v=19$m=19456,t=2,p=1$stored-parameterized-hash",
      { tokenHash, expiresAt },
    );
    expect(registered).toMatchObject({
      username: "alice_123",
      displayName: "alice_123",
      tokenHash,
    });
    expect(registered.userId).toMatch(/^[0-9a-f-]{36}$/u);
    await expect(
      accountRepository.resolveAccountSession(tokenHash, new Date()),
    ).resolves.toMatchObject({
      username: "alice_123",
      displayName: "alice_123",
      tokenHash,
    });

    await accountRepository.updateDisplayName(registered.userId, "玩家一");
    await expect(
      accountRepository.resolveAccountSession(tokenHash, new Date()),
    ).resolves.toMatchObject({
      username: "alice_123",
      displayName: "玩家一",
    });
    await expect(
      accountRepository.findPasswordAccountByUsername("alice_123"),
    ).resolves.toMatchObject({ displayName: "玩家一" });

    const rebuiltClient = createPostgresDatabaseClient({
      url: isolated.url,
      applicationName: "database-integration-profile-rebuild",
      maxConnections: 2,
    });
    try {
      await expect(
        new PostgresAccountRepository(
          rebuiltClient.database,
        ).resolveAccountSession(tokenHash, new Date()),
      ).resolves.toMatchObject({ displayName: "玩家一" });
    } finally {
      await rebuiltClient.close();
    }

    const storedSessions = await isolated.client.database
      .select({ tokenHash: accountSessions.tokenHash })
      .from(accountSessions);
    expect(storedSessions).toContainEqual({ tokenHash });
    expect(JSON.stringify(storedSessions)).not.toContain(token);

    await expect(
      accountRepository.registerPasswordAccount(
        "alice_123",
        "$argon2id$v=19$m=19456,t=2,p=1$another-hash",
        { tokenHash: "b".repeat(64), expiresAt },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AccountRepositoryError>>({
        code: "USERNAME_UNAVAILABLE",
      }),
    );
  });

  it("expires, deletes, and revokes account sessions transactionally", async () => {
    const currentHash = "c".repeat(64);
    const otherHash = "d".repeat(64);
    const expiredHash = "e".repeat(64);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() + 60_000);
    const registered = await accountRepository.registerPasswordAccount(
      "session_user",
      "$argon2id$v=19$m=19456,t=2,p=1$old-hash",
      { tokenHash: currentHash, expiresAt },
    );
    await accountRepository.createAccountSession(registered.userId, {
      tokenHash: otherHash,
      expiresAt,
    });
    await accountRepository.createAccountSession(registered.userId, {
      tokenHash: expiredHash,
      expiresAt: expiredAt,
    });
    await expect(
      accountRepository.resolveAccountSession(
        expiredHash,
        new Date(expiredAt.getTime()),
      ),
    ).resolves.toBeNull();

    await accountRepository.changePasswordAndRevokeOtherSessions(
      registered.userId,
      "$argon2id$v=19$m=19456,t=2,p=1$old-hash",
      "$argon2id$v=19$m=19456,t=2,p=1$new-hash",
      currentHash,
    );
    await expect(
      accountRepository.resolveAccountSession(otherHash, new Date()),
    ).resolves.toBeNull();
    await expect(
      accountRepository.resolveAccountSession(currentHash, new Date()),
    ).resolves.toMatchObject({ userId: registered.userId });
    await expect(
      accountRepository.findPasswordAccountByUsername("session_user"),
    ).resolves.toMatchObject({
      passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$new-hash",
    });

    await expect(
      accountRepository.changePasswordAndRevokeOtherSessions(
        registered.userId,
        "$argon2id$v=19$m=19456,t=2,p=1$old-hash",
        "$argon2id$v=19$m=19456,t=2,p=1$unexpected",
        currentHash,
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_STATE_CONFLICT" });
    await accountRepository.deleteAccountSession(currentHash);
    await expect(
      accountRepository.resolveAccountSession(currentHash, new Date()),
    ).resolves.toBeNull();
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
    const userA = await userRepository.createUser();
    const userB = await userRepository.createUser();
    await replayStore.create("replay-completed-match", header);
    const waiting = roomRecord(
      "runtime-completed",
      "HJST2345",
      "replay-completed-match",
      "guest-history-a",
      userA.userId,
      userB.userId,
    );
    await roomStore.create({ ...waiting, currentRound: null });
    await expect(matchRepository.listForUser(userA.userId)).resolves.toEqual(
      [],
    );
    const [firstPlayer, secondPlayer] = waiting.players;
    if (firstPlayer === undefined || secondPlayer === undefined) {
      throw new Error("Expected two preallocated player slots.");
    }
    const active: StoredGameRoom = {
      ...waiting,
      players: [
        firstPlayer,
        {
          ...secondPlayer,
          playerSessionId: "guest-history-b",
        },
      ],
    };
    await matchArchive.createRound(active);
    await roomStore.save(active);
    for (const action of winningActions) {
      await replayStore.append(
        currentRound(active).replayId,
        action.sequence - 1,
        action,
      );
    }
    await replayStore.complete(
      currentRound(active).replayId,
      5,
      0,
      winningOutcome,
    );
    const completed: StoredGameRoom = {
      ...active,
      currentRound: {
        ...currentRound(active),
        revision: 5,
        status: "completed",
        outcome: winningOutcome,
      },
    };
    await matchArchive.saveRound(completed);
    await roomStore.save(completed);

    const historyA = await matchRepository.listForUser(userA.userId);
    const historyB = await matchRepository.listForUser(userB.userId);
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
    const completedMatchId = historyA[0]?.matchId;
    if (completedMatchId === undefined) {
      throw new Error("Expected completed match id.");
    }
    await expect(
      matchRepository.getCompletedReplayForUser(userA.userId, completedMatchId),
    ).resolves.toMatchObject({
      status: "available",
      playerSlotId: "slot-1",
      match: {
        status: "completed",
        finalRevision: 5,
      },
      replay: { header, actions: winningActions },
    });
    await expect(
      matchRepository.getCompletedReplayForUser(userB.userId, completedMatchId),
    ).resolves.toMatchObject({ status: "available", playerSlotId: "slot-2" });
    await expect(
      matchRepository.getCompletedReplayForUser(
        (await userRepository.createUser()).userId,
        completedMatchId,
      ),
    ).resolves.toEqual({ status: "not-found" });
    await expect(
      matchRepository.getCompletedReplayForUser(
        userA.userId,
        "00000000-0000-4000-8000-000000000000",
      ),
    ).resolves.toEqual({ status: "not-found" });
    await replayStore.create("replay-abandoned-match", header);
    const abandonedWaiting = roomRecord(
      "runtime-abandoned",
      "ABND2345",
      "replay-abandoned-match",
      "guest-history-a",
      userA.userId,
      userB.userId,
    );
    await matchArchive.createRound(abandonedWaiting);
    await matchArchive.saveRound({
      ...abandonedWaiting,
      currentRound: {
        ...currentRound(abandonedWaiting),
        status: "abandoned",
      },
    });
    const historyAfterAbandon = await matchRepository.listForUser(userA.userId);
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
    const abandonedMatch = historyAfterAbandon.find(
      (item) => item.status === "abandoned",
    );
    if (abandonedMatch === undefined) {
      throw new Error("Expected abandoned match history item.");
    }
    await expect(
      matchRepository.getCompletedReplayForUser(
        userA.userId,
        abandonedMatch.matchId,
      ),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("archives consecutive rounds in one runtime room with independent replay and history", async () => {
    const userA = await userRepository.createUser();
    const userB = await userRepository.createUser();
    await replayStore.create("replay-round-one", header);
    const waiting = roomRecord(
      "runtime-multi-round",
      "RUND2345",
      "replay-round-one",
      "guest-round-a",
      userA.userId,
      userB.userId,
    );
    const [firstPlayer, secondPlayer] = waiting.players;
    if (firstPlayer === undefined || secondPlayer === undefined) {
      throw new Error("Expected two preallocated player slots.");
    }
    const activeRoundOne: StoredGameRoom = {
      ...waiting,
      players: [
        firstPlayer,
        { ...secondPlayer, playerSessionId: "guest-round-b" },
      ],
    };
    await matchArchive.createRound(activeRoundOne);
    for (const action of winningActions) {
      await replayStore.append(
        currentRound(activeRoundOne).replayId,
        action.sequence - 1,
        action,
      );
    }
    await replayStore.complete(
      currentRound(activeRoundOne).replayId,
      5,
      0,
      winningOutcome,
    );
    await matchArchive.saveRound({
      ...activeRoundOne,
      currentRound: {
        ...currentRound(activeRoundOne),
        revision: 5,
        status: "completed",
        outcome: winningOutcome,
      },
    });

    const roundTwoHeader: ReplayHeader = {
      ...header,
      rng: { ...header.rng, seed: "database-replay-round-two-seed" },
    };
    await replayStore.create("replay-round-two", roundTwoHeader);
    const activeRoundTwo: StoredGameRoom = {
      ...activeRoundOne,
      currentRound: {
        ...currentRound(activeRoundOne),
        roundNumber: 2,
        replayId: "replay-round-two",
        playerOrder: ["slot-2", "slot-1"],
        state: currentRound(waiting).state,
        rng: createRng(roundTwoHeader.rng.seed),
        revision: 0,
        status: "active",
        outcome: null,
      },
    };
    await matchArchive.createRound(activeRoundTwo);
    for (const action of winningActions) {
      await replayStore.append(
        currentRound(activeRoundTwo).replayId,
        action.sequence - 1,
        action,
      );
    }
    await replayStore.complete(
      currentRound(activeRoundTwo).replayId,
      5,
      0,
      winningOutcome,
    );
    await matchArchive.saveRound({
      ...activeRoundTwo,
      currentRound: {
        ...currentRound(activeRoundTwo),
        revision: 5,
        status: "completed",
        outcome: winningOutcome,
      },
    });

    const history = await matchRepository.listForUser(userA.userId);
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
      matchArchive.createRound({
        ...activeRoundTwo,
        currentRound: {
          ...currentRound(activeRoundTwo),
          roundNumber: 4,
          replayId: "replay-skipped-round",
          revision: 0,
          status: "active",
          outcome: null,
        },
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
      await expect(rebuiltMatches.listForUser(userA.userId)).resolves.toEqual(
        history,
      );
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
    const privateUser = await userRepository.createUser();
    const unrelatedUser = await userRepository.createUser();
    await replayStore.create("replay-private-match", header);
    const privateWaiting = roomRecord(
      "runtime-private",
      "PRJV2345",
      "replay-private-match",
      "guest-private",
      privateUser.userId,
    );
    await matchArchive.createRound(privateWaiting);
    await matchArchive.saveRound({
      ...privateWaiting,
      currentRound: {
        ...currentRound(privateWaiting),
        status: "abandoned",
      },
    });
    const privateHistory = await matchRepository.listForUser(
      privateUser.userId,
    );
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
        rebuiltMatches.listForUser(unrelatedUser.userId),
      ).resolves.toEqual([]);
      await expect(
        rebuiltMatches.listForUser(privateUser.userId),
      ).resolves.toEqual([
        expect.objectContaining({
          matchId: privateMatchId,
          status: "abandoned",
        }),
      ]);
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

  it("never claims anonymous rounds and only records identity snapshotted at round start", async () => {
    await replayStore.create("replay-anonymous-snapshot", header);
    const anonymous = roomRecord(
      "runtime-anonymous-snapshot",
      "ANON2345",
      "replay-anonymous-snapshot",
      "stable-session-a",
    );
    await matchArchive.createRound(anonymous);

    const user = await userRepository.createUser();
    await expect(
      matchArchive.saveRound({
        ...anonymous,
        players: anonymous.players.map((player) => ({
          ...player,
          userId: player.slotId === "slot-1" ? user.userId : null,
        })),
      }),
    ).rejects.toMatchObject({ code: "DATABASE_OPERATION_ERROR" });
    await expect(matchRepository.listForUser(user.userId)).resolves.toEqual([]);

    await replayStore.create("replay-account-snapshot", header);
    const accountRound = roomRecord(
      "runtime-account-snapshot",
      "ACCT2345",
      "replay-account-snapshot",
      "rotated-session-a",
      user.userId,
    );
    await matchArchive.createRound(accountRound);
    await matchArchive.saveRound({
      ...accountRound,
      currentRound: {
        ...currentRound(accountRound),
        status: "abandoned",
      },
    });
    await expect(matchRepository.listForUser(user.userId)).resolves.toEqual([
      expect.objectContaining({
        roundNumber: 1,
        status: "abandoned",
        playerSlotId: "slot-1",
      }),
    ]);
  });

  it("marks residual waiting/active archives abandoned without restoring rooms", async () => {
    const user = await userRepository.createUser();
    await replayStore.create("replay-startup-residual", header);
    const residual = roomRecord(
      "runtime-residual",
      "LEFT2345",
      "replay-startup-residual",
      "guest-residual",
      user.userId,
    );
    await matchArchive.createRound(residual);
    expect(await matchRepository.abandonIncompleteMatches()).toBeGreaterThan(0);
    await expect(matchRepository.listForUser(user.userId)).resolves.toEqual([
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
