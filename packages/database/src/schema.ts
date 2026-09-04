import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const matchStatusEnum = pgEnum("match_status", [
  "waiting",
  "active",
  "completed",
  "abandoned",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "users_display_name_length_valid",
      sql`length(trim(${table.displayName})) between 1 and 96`,
    ),
    check("users_created_at_valid", sql`${table.createdAt} <= now()`),
  ],
);

export const passwordCredentials = pgTable(
  "password_credentials",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("password_credentials_username_unique").on(table.username),
    check(
      "password_credentials_username_format",
      sql`${table.username} ~ '^[a-z0-9_]{3,24}$'`,
    ),
    check(
      "password_credentials_hash_length",
      sql`length(${table.passwordHash}) between 1 and 1024`,
    ),
    check(
      "password_credentials_timestamps_valid",
      sql`${table.createdAt} <= ${table.updatedAt} and ${table.updatedAt} <= now()`,
    ),
  ],
);

export const accountSessions = pgTable(
  "account_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    uniqueIndex("account_sessions_token_hash_unique").on(table.tokenHash),
    index("account_sessions_user_expiry_idx").on(table.userId, table.expiresAt),
    check(
      "account_sessions_token_hash_format",
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "account_sessions_expiry_valid",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const replays = pgTable(
  "replays",
  {
    id: text("id").primaryKey(),
    replayFormatVersion: integer("replay_format_version").notNull(),
    gameId: text("game_id").notNull(),
    gameVersion: text("game_version").notNull(),
    rngAlgorithm: text("rng_algorithm").notNull(),
    rngSeed: text("rng_seed").notNull(),
    initialConfig: jsonb("initial_config").$type<unknown>().notNull(),
    players: jsonb("players").$type<unknown>().notNull(),
    recordedRngCursor: bigint("recorded_rng_cursor", {
      mode: "number",
    }),
    recordedOutcome: jsonb("recorded_outcome").$type<unknown>(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    check("replays_id_not_empty", sql`length(${table.id}) > 0`),
    check(
      "replays_format_version_positive",
      sql`${table.replayFormatVersion} > 0`,
    ),
    check("replays_game_id_not_empty", sql`length(${table.gameId}) > 0`),
    check(
      "replays_game_version_not_empty",
      sql`length(${table.gameVersion}) > 0`,
    ),
    check(
      "replays_rng_algorithm_not_empty",
      sql`length(${table.rngAlgorithm}) > 0`,
    ),
    check("replays_rng_seed_not_empty", sql`length(${table.rngSeed}) > 0`),
    check(
      "replays_completion_consistent",
      sql`(
        (${table.completedAt} is null and ${table.recordedRngCursor} is null and ${table.recordedOutcome} is null)
        or
        (${table.completedAt} is not null and ${table.recordedRngCursor} >= 0 and ${table.recordedOutcome} is not null)
      )`,
    ),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey(),
    runtimeRoomId: text("runtime_room_id").notNull(),
    roundNumber: integer("round_number").default(1).notNull(),
    replayId: text("replay_id")
      .notNull()
      .references(() => replays.id, { onDelete: "restrict" }),
    gameId: text("game_id").notNull(),
    gameVersion: text("game_version").notNull(),
    status: matchStatusEnum("status").notNull(),
    finalRevision: bigint("final_revision", { mode: "number" })
      .default(0)
      .notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
    abandonedAt: timestamp("abandoned_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    unique("matches_runtime_room_round_unique").on(
      table.runtimeRoomId,
      table.roundNumber,
    ),
    unique("matches_replay_id_unique").on(table.replayId),
    index("matches_history_order_idx").on(table.createdAt, table.id),
    check(
      "matches_runtime_room_id_not_empty",
      sql`length(${table.runtimeRoomId}) > 0`,
    ),
    check("matches_round_number_positive", sql`${table.roundNumber} > 0`),
    check("matches_game_id_not_empty", sql`length(${table.gameId}) > 0`),
    check(
      "matches_game_version_not_empty",
      sql`length(${table.gameVersion}) > 0`,
    ),
    check(
      "matches_final_revision_nonnegative",
      sql`${table.finalRevision} >= 0`,
    ),
    check(
      "matches_lifecycle_timestamps",
      sql`(
        (${table.status} = 'waiting' and ${table.startedAt} is null and ${table.completedAt} is null and ${table.abandonedAt} is null)
        or
        (${table.status} = 'active' and ${table.startedAt} is not null and ${table.completedAt} is null and ${table.abandonedAt} is null)
        or
        (${table.status} = 'completed' and ${table.startedAt} is not null and ${table.completedAt} is not null and ${table.abandonedAt} is null)
        or
        (${table.status} = 'abandoned' and ${table.completedAt} is null and ${table.abandonedAt} is not null)
      )`,
    ),
  ],
);

export const matchPlayers = pgTable(
  "match_players",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    playerSlotId: text("player_slot_id").notNull(),
    playerSessionId: text("player_session_id").notNull(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    joinedAt: timestamp("joined_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "match_players_match_slot_pk",
      columns: [table.matchId, table.playerSlotId],
    }),
    unique("match_players_match_session_unique").on(
      table.matchId,
      table.playerSessionId,
    ),
    index("match_players_session_history_idx").on(
      table.playerSessionId,
      table.matchId,
    ),
    index("match_players_user_history_idx").on(table.userId, table.matchId),
    check(
      "match_players_slot_not_empty",
      sql`length(${table.playerSlotId}) > 0`,
    ),
    check(
      "match_players_session_not_empty",
      sql`length(${table.playerSessionId}) > 0`,
    ),
  ],
);

export const replayActions = pgTable(
  "replay_actions",
  {
    replayId: text("replay_id")
      .notNull()
      .references(() => replays.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    actorSlotId: text("actor_slot_id").notNull(),
    action: jsonb("action").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "replay_actions_replay_sequence_pk",
      columns: [table.replayId, table.sequence],
    }),
    check("replay_actions_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "replay_actions_actor_not_empty",
      sql`length(${table.actorSlotId}) > 0`,
    ),
  ],
);

/** Realtime Replay Format V1 has explicit runtime/tick columns. */
export const realtimeReplays = pgTable(
  "realtime_replays",
  {
    id: text("id").primaryKey(),
    replayFormatVersion: integer("replay_format_version").notNull(),
    runtime: text("runtime").notNull(),
    gameId: text("game_id").notNull(),
    gameVersion: text("game_version").notNull(),
    tickRate: integer("tick_rate").notNull(),
    rngAlgorithm: text("rng_algorithm").notNull(),
    rngSeed: text("rng_seed").notNull(),
    initialConfig: jsonb("initial_config").$type<unknown>().notNull(),
    players: jsonb("players").$type<unknown>().notNull(),
    recordedRngCursor: bigint("recorded_rng_cursor", { mode: "number" }),
    recordedOutcome: jsonb("recorded_outcome").$type<unknown>(),
    finalTick: bigint("final_tick", { mode: "number" }).default(0).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    check("realtime_replays_id_not_empty", sql`length(${table.id}) > 0`),
    check(
      "realtime_replays_format_version",
      sql`${table.replayFormatVersion} = 1`,
    ),
    check("realtime_replays_runtime", sql`${table.runtime} = 'realtime'`),
    check(
      "realtime_replays_game_id_not_empty",
      sql`length(${table.gameId}) > 0`,
    ),
    check(
      "realtime_replays_game_version_not_empty",
      sql`length(${table.gameVersion}) > 0`,
    ),
    check("realtime_replays_tick_rate", sql`${table.tickRate} = 60`),
    check(
      "realtime_replays_rng_algorithm",
      sql`${table.rngAlgorithm} = 'fnv1a32-counter-v1'`,
    ),
    check(
      "realtime_replays_rng_seed_not_empty",
      sql`length(${table.rngSeed}) > 0`,
    ),
    check(
      "realtime_replays_final_tick_nonnegative",
      sql`${table.finalTick} >= 0`,
    ),
    check(
      "realtime_replays_completion_consistent",
      sql`(
        (${table.completedAt} is null and ${table.recordedRngCursor} is null and ${table.recordedOutcome} is null)
        or
        (${table.completedAt} is not null and ${table.recordedRngCursor} >= 0 and ${table.recordedOutcome} is not null and ${table.finalTick} > 0)
      )`,
    ),
  ],
);

export const realtimeReplayEvents = pgTable(
  "realtime_replay_events",
  {
    replayId: text("replay_id")
      .notNull()
      .references(() => realtimeReplays.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    tick: bigint("tick", { mode: "number" }).notNull(),
    actorSlotId: text("actor_slot_id").notNull(),
    input: jsonb("input").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "realtime_replay_events_replay_sequence_pk",
      columns: [table.replayId, table.sequence],
    }),
    check(
      "realtime_replay_events_sequence_positive",
      sql`${table.sequence} > 0`,
    ),
    check("realtime_replay_events_tick_nonnegative", sql`${table.tick} >= 0`),
    check(
      "realtime_replay_events_actor_not_empty",
      sql`length(${table.actorSlotId}) > 0`,
    ),
  ],
);

export const realtimeRooms = pgTable(
  "realtime_rooms",
  {
    roomId: text("room_id").primaryKey(),
    roomCode: text("room_code").notNull(),
    gameId: text("game_id").notNull(),
    gameVersion: text("game_version").notNull(),
    setupProtocol: integer("setup_protocol").default(5).notNull(),
    initialConfig: jsonb("initial_config").$type<unknown>().notNull(),
    nextRoundSetup: jsonb("next_round_setup").$type<unknown>(),
    previousFinalizedSetup: jsonb("previous_finalized_setup").$type<unknown>(),
    currentRoundNumber: integer("current_round_number"),
    currentReplayId: text("current_replay_id").references(
      () => realtimeReplays.id,
      { onDelete: "restrict" },
    ),
    currentPlayerOrder: jsonb("current_player_order").$type<unknown>(),
    currentTick: bigint("current_tick", { mode: "number" })
      .default(0)
      .notNull(),
    currentStatus: matchStatusEnum("current_status"),
    currentOutcome: jsonb("current_outcome").$type<unknown>(),
    closeReason: text("close_reason"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("realtime_rooms_room_code_unique").on(table.roomCode),
    check("realtime_rooms_room_id_not_empty", sql`length(${table.roomId}) > 0`),
    check(
      "realtime_rooms_room_code_format",
      sql`${table.roomCode} ~ '^[A-HJ-NP-Z2-9]{8}$'`,
    ),
    check("realtime_rooms_game_id_not_empty", sql`length(${table.gameId}) > 0`),
    check(
      "realtime_rooms_game_version_not_empty",
      sql`length(${table.gameVersion}) > 0`,
    ),
    check(
      "realtime_rooms_setup_protocol_supported",
      sql`${table.setupProtocol} in (5, 6)`,
    ),
    check(
      "realtime_rooms_setup_state_consistent",
      sql`(
        (${table.setupProtocol} = 5 and ${table.nextRoundSetup} is null and ${table.previousFinalizedSetup} is null)
        or
        (${table.setupProtocol} = 6 and (
          (${table.currentRoundNumber} is null and ${table.nextRoundSetup} is not null and ${table.previousFinalizedSetup} is null)
          or
          (${table.currentRoundNumber} is not null and ${table.previousFinalizedSetup} is not null and (
            (${table.currentStatus} = 'completed' and ${table.nextRoundSetup} is not null)
            or
            (${table.currentStatus} in ('active', 'abandoned') and ${table.nextRoundSetup} is null)
          ))
        ))
      )`,
    ),
    check(
      "realtime_rooms_current_tick_nonnegative",
      sql`${table.currentTick} >= 0`,
    ),
    check(
      "realtime_rooms_round_consistent",
      sql`(
        (${table.currentRoundNumber} is null and ${table.currentReplayId} is null and ${table.currentPlayerOrder} is null and ${table.currentStatus} is null and ${table.currentTick} = 0)
        or
        (${table.currentRoundNumber} > 0 and ${table.currentReplayId} is not null and ${table.currentPlayerOrder} is not null and ${table.currentStatus} is not null)
      )`,
    ),
    check(
      "realtime_rooms_close_reason_consistent",
      sql`(${table.closeReason} is null or ${table.closeReason} in ('OWNER_CLOSED','PLAYER_LEFT','RECONNECT_TIMEOUT','REMATCH_TIMEOUT'))`,
    ),
  ],
);

export const realtimeRoomPlayers = pgTable(
  "realtime_room_players",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => realtimeRooms.roomId, { onDelete: "cascade" }),
    playerSlotId: text("player_slot_id").notNull(),
    playerSessionId: text("player_session_id"),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    reservedUntil: timestamp("reserved_until", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    primaryKey({
      name: "realtime_room_players_room_slot_pk",
      columns: [table.roomId, table.playerSlotId],
    }),
    check(
      "realtime_room_players_slot_not_empty",
      sql`length(${table.playerSlotId}) > 0`,
    ),
    check(
      "realtime_room_players_session_not_empty",
      sql`${table.playerSessionId} is null or length(${table.playerSessionId}) > 0`,
    ),
  ],
);

export const realtimeMatches = pgTable(
  "realtime_matches",
  {
    id: uuid("id").primaryKey(),
    runtimeRoomId: text("runtime_room_id").notNull(),
    roundNumber: integer("round_number").notNull(),
    replayId: text("replay_id")
      .notNull()
      .references(() => realtimeReplays.id, { onDelete: "restrict" }),
    gameId: text("game_id").notNull(),
    gameVersion: text("game_version").notNull(),
    status: matchStatusEnum("status").notNull(),
    finalTick: bigint("final_tick", { mode: "number" }).default(0).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
    abandonedAt: timestamp("abandoned_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    unique("realtime_matches_room_round_unique").on(
      table.runtimeRoomId,
      table.roundNumber,
    ),
    unique("realtime_matches_replay_id_unique").on(table.replayId),
    index("realtime_matches_history_order_idx").on(table.createdAt, table.id),
    check("realtime_matches_round_positive", sql`${table.roundNumber} > 0`),
    check(
      "realtime_matches_final_tick_nonnegative",
      sql`${table.finalTick} >= 0`,
    ),
    check(
      "realtime_matches_lifecycle_timestamps",
      sql`(
        (${table.status} = 'active' and ${table.startedAt} is not null and ${table.completedAt} is null and ${table.abandonedAt} is null)
        or
        (${table.status} = 'completed' and ${table.startedAt} is not null and ${table.completedAt} is not null and ${table.abandonedAt} is null)
        or
        (${table.status} = 'abandoned' and ${table.abandonedAt} is not null and ${table.completedAt} is null)
      )`,
    ),
  ],
);

export const realtimeMatchPlayers = pgTable(
  "realtime_match_players",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => realtimeMatches.id, { onDelete: "cascade" }),
    playerSlotId: text("player_slot_id").notNull(),
    playerSessionId: text("player_session_id").notNull(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    joinedAt: timestamp("joined_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "realtime_match_players_match_slot_pk",
      columns: [table.matchId, table.playerSlotId],
    }),
    unique("realtime_match_players_match_session_unique").on(
      table.matchId,
      table.playerSessionId,
    ),
    index("realtime_match_players_user_history_idx").on(
      table.userId,
      table.matchId,
    ),
    check(
      "realtime_match_players_slot_not_empty",
      sql`length(${table.playerSlotId}) > 0`,
    ),
    check(
      "realtime_match_players_session_not_empty",
      sql`length(${table.playerSessionId}) > 0`,
    ),
  ],
);

export const databaseSchema = {
  accountSessions,
  matchPlayers,
  matches,
  passwordCredentials,
  replayActions,
  replays,
  realtimeMatchPlayers,
  realtimeMatches,
  realtimeReplayEvents,
  realtimeReplays,
  realtimeRoomPlayers,
  realtimeRooms,
  users,
};
