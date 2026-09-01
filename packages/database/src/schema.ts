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
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("users_created_at_valid", sql`${table.createdAt} <= now()`),
  ],
);

export const guestUserAssociations = pgTable(
  "guest_user_associations",
  {
    playerSessionId: text("player_session_id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "guest_user_associations_session_not_empty",
      sql`length(${table.playerSessionId}) > 0`,
    ),
    index("guest_user_associations_user_idx").on(table.userId),
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

export const databaseSchema = {
  accountSessions,
  guestUserAssociations,
  matchPlayers,
  matches,
  passwordCredentials,
  replayActions,
  replays,
  users,
};
