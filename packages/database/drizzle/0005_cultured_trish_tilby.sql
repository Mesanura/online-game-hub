CREATE TABLE "realtime_match_players" (
	"match_id" uuid NOT NULL,
	"player_slot_id" text NOT NULL,
	"player_session_id" text NOT NULL,
	"user_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realtime_match_players_match_slot_pk" PRIMARY KEY("match_id","player_slot_id"),
	CONSTRAINT "realtime_match_players_match_session_unique" UNIQUE("match_id","player_session_id"),
	CONSTRAINT "realtime_match_players_slot_not_empty" CHECK (length("realtime_match_players"."player_slot_id") > 0),
	CONSTRAINT "realtime_match_players_session_not_empty" CHECK (length("realtime_match_players"."player_session_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "realtime_matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"runtime_room_id" text NOT NULL,
	"round_number" integer NOT NULL,
	"replay_id" text NOT NULL,
	"game_id" text NOT NULL,
	"game_version" text NOT NULL,
	"status" "match_status" NOT NULL,
	"final_tick" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	CONSTRAINT "realtime_matches_room_round_unique" UNIQUE("runtime_room_id","round_number"),
	CONSTRAINT "realtime_matches_replay_id_unique" UNIQUE("replay_id"),
	CONSTRAINT "realtime_matches_round_positive" CHECK ("realtime_matches"."round_number" > 0),
	CONSTRAINT "realtime_matches_final_tick_nonnegative" CHECK ("realtime_matches"."final_tick" >= 0),
	CONSTRAINT "realtime_matches_lifecycle_timestamps" CHECK ((
        ("realtime_matches"."status" = 'active' and "realtime_matches"."started_at" is not null and "realtime_matches"."completed_at" is null and "realtime_matches"."abandoned_at" is null)
        or
        ("realtime_matches"."status" = 'completed' and "realtime_matches"."started_at" is not null and "realtime_matches"."completed_at" is not null and "realtime_matches"."abandoned_at" is null)
        or
        ("realtime_matches"."status" = 'abandoned' and "realtime_matches"."abandoned_at" is not null and "realtime_matches"."completed_at" is null)
      ))
);
--> statement-breakpoint
CREATE TABLE "realtime_replay_events" (
	"replay_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"tick" bigint NOT NULL,
	"actor_slot_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realtime_replay_events_replay_sequence_pk" PRIMARY KEY("replay_id","sequence"),
	CONSTRAINT "realtime_replay_events_sequence_positive" CHECK ("realtime_replay_events"."sequence" > 0),
	CONSTRAINT "realtime_replay_events_tick_nonnegative" CHECK ("realtime_replay_events"."tick" >= 0),
	CONSTRAINT "realtime_replay_events_actor_not_empty" CHECK (length("realtime_replay_events"."actor_slot_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "realtime_replays" (
	"id" text PRIMARY KEY NOT NULL,
	"replay_format_version" integer NOT NULL,
	"runtime" text NOT NULL,
	"game_id" text NOT NULL,
	"game_version" text NOT NULL,
	"tick_rate" integer NOT NULL,
	"rng_algorithm" text NOT NULL,
	"rng_seed" text NOT NULL,
	"initial_config" jsonb NOT NULL,
	"players" jsonb NOT NULL,
	"recorded_rng_cursor" bigint,
	"recorded_outcome" jsonb,
	"final_tick" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "realtime_replays_id_not_empty" CHECK (length("realtime_replays"."id") > 0),
	CONSTRAINT "realtime_replays_format_version" CHECK ("realtime_replays"."replay_format_version" = 1),
	CONSTRAINT "realtime_replays_runtime" CHECK ("realtime_replays"."runtime" = 'realtime'),
	CONSTRAINT "realtime_replays_game_id_not_empty" CHECK (length("realtime_replays"."game_id") > 0),
	CONSTRAINT "realtime_replays_game_version_not_empty" CHECK (length("realtime_replays"."game_version") > 0),
	CONSTRAINT "realtime_replays_tick_rate" CHECK ("realtime_replays"."tick_rate" = 60),
	CONSTRAINT "realtime_replays_rng_algorithm" CHECK ("realtime_replays"."rng_algorithm" = 'fnv1a32-counter-v1'),
	CONSTRAINT "realtime_replays_rng_seed_not_empty" CHECK (length("realtime_replays"."rng_seed") > 0),
	CONSTRAINT "realtime_replays_final_tick_nonnegative" CHECK ("realtime_replays"."final_tick" >= 0),
	CONSTRAINT "realtime_replays_completion_consistent" CHECK ((
        ("realtime_replays"."completed_at" is null and "realtime_replays"."recorded_rng_cursor" is null and "realtime_replays"."recorded_outcome" is null)
        or
        ("realtime_replays"."completed_at" is not null and "realtime_replays"."recorded_rng_cursor" >= 0 and "realtime_replays"."recorded_outcome" is not null and "realtime_replays"."final_tick" > 0)
      ))
);
--> statement-breakpoint
CREATE TABLE "realtime_room_players" (
	"room_id" text NOT NULL,
	"player_slot_id" text NOT NULL,
	"player_session_id" text,
	"user_id" uuid,
	"reserved_until" timestamp with time zone,
	CONSTRAINT "realtime_room_players_room_slot_pk" PRIMARY KEY("room_id","player_slot_id"),
	CONSTRAINT "realtime_room_players_slot_not_empty" CHECK (length("realtime_room_players"."player_slot_id") > 0),
	CONSTRAINT "realtime_room_players_session_not_empty" CHECK ("realtime_room_players"."player_session_id" is null or length("realtime_room_players"."player_session_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "realtime_rooms" (
	"room_id" text PRIMARY KEY NOT NULL,
	"room_code" text NOT NULL,
	"game_id" text NOT NULL,
	"game_version" text NOT NULL,
	"initial_config" jsonb NOT NULL,
	"current_round_number" integer,
	"current_replay_id" text,
	"current_tick" bigint DEFAULT 0 NOT NULL,
	"current_status" "match_status",
	"current_outcome" jsonb,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realtime_rooms_room_id_not_empty" CHECK (length("realtime_rooms"."room_id") > 0),
	CONSTRAINT "realtime_rooms_room_code_format" CHECK ("realtime_rooms"."room_code" ~ '^[A-HJ-NP-Z2-9]{8}$'),
	CONSTRAINT "realtime_rooms_game_id_not_empty" CHECK (length("realtime_rooms"."game_id") > 0),
	CONSTRAINT "realtime_rooms_game_version_not_empty" CHECK (length("realtime_rooms"."game_version") > 0),
	CONSTRAINT "realtime_rooms_current_tick_nonnegative" CHECK ("realtime_rooms"."current_tick" >= 0),
	CONSTRAINT "realtime_rooms_round_consistent" CHECK ((
        ("realtime_rooms"."current_round_number" is null and "realtime_rooms"."current_replay_id" is null and "realtime_rooms"."current_status" is null and "realtime_rooms"."current_tick" = 0)
        or
        ("realtime_rooms"."current_round_number" > 0 and "realtime_rooms"."current_replay_id" is not null and "realtime_rooms"."current_status" is not null)
      )),
	CONSTRAINT "realtime_rooms_close_reason_consistent" CHECK (("realtime_rooms"."close_reason" is null or "realtime_rooms"."close_reason" in ('OWNER_CLOSED','PLAYER_LEFT','RECONNECT_TIMEOUT','REMATCH_TIMEOUT')))
);
--> statement-breakpoint
ALTER TABLE "realtime_match_players" ADD CONSTRAINT "realtime_match_players_match_id_realtime_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."realtime_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_match_players" ADD CONSTRAINT "realtime_match_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_matches" ADD CONSTRAINT "realtime_matches_replay_id_realtime_replays_id_fk" FOREIGN KEY ("replay_id") REFERENCES "public"."realtime_replays"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_replay_events" ADD CONSTRAINT "realtime_replay_events_replay_id_realtime_replays_id_fk" FOREIGN KEY ("replay_id") REFERENCES "public"."realtime_replays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_room_players" ADD CONSTRAINT "realtime_room_players_room_id_realtime_rooms_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."realtime_rooms"("room_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_room_players" ADD CONSTRAINT "realtime_room_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_rooms" ADD CONSTRAINT "realtime_rooms_current_replay_id_realtime_replays_id_fk" FOREIGN KEY ("current_replay_id") REFERENCES "public"."realtime_replays"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "realtime_match_players_user_history_idx" ON "realtime_match_players" USING btree ("user_id","match_id");--> statement-breakpoint
CREATE INDEX "realtime_matches_history_order_idx" ON "realtime_matches" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "realtime_rooms_room_code_unique" ON "realtime_rooms" USING btree ("room_code");