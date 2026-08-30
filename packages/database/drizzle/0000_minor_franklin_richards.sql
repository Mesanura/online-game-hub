CREATE TYPE "public"."match_status" AS ENUM('waiting', 'active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "guest_user_associations" (
	"player_session_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_user_associations_session_not_empty" CHECK (length("guest_user_associations"."player_session_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "match_players" (
	"match_id" uuid NOT NULL,
	"player_slot_id" text NOT NULL,
	"player_session_id" text NOT NULL,
	"user_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_players_match_slot_pk" PRIMARY KEY("match_id","player_slot_id"),
	CONSTRAINT "match_players_match_session_unique" UNIQUE("match_id","player_session_id"),
	CONSTRAINT "match_players_slot_not_empty" CHECK (length("match_players"."player_slot_id") > 0),
	CONSTRAINT "match_players_session_not_empty" CHECK (length("match_players"."player_session_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"runtime_room_id" text NOT NULL,
	"replay_id" text NOT NULL,
	"game_id" text NOT NULL,
	"game_version" text NOT NULL,
	"status" "match_status" NOT NULL,
	"final_revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	CONSTRAINT "matches_runtime_room_id_unique" UNIQUE("runtime_room_id"),
	CONSTRAINT "matches_replay_id_unique" UNIQUE("replay_id"),
	CONSTRAINT "matches_runtime_room_id_not_empty" CHECK (length("matches"."runtime_room_id") > 0),
	CONSTRAINT "matches_game_id_not_empty" CHECK (length("matches"."game_id") > 0),
	CONSTRAINT "matches_game_version_not_empty" CHECK (length("matches"."game_version") > 0),
	CONSTRAINT "matches_final_revision_nonnegative" CHECK ("matches"."final_revision" >= 0),
	CONSTRAINT "matches_lifecycle_timestamps" CHECK ((
        ("matches"."status" = 'waiting' and "matches"."started_at" is null and "matches"."completed_at" is null and "matches"."abandoned_at" is null)
        or
        ("matches"."status" = 'active' and "matches"."started_at" is not null and "matches"."completed_at" is null and "matches"."abandoned_at" is null)
        or
        ("matches"."status" = 'completed' and "matches"."started_at" is not null and "matches"."completed_at" is not null and "matches"."abandoned_at" is null)
        or
        ("matches"."status" = 'abandoned' and "matches"."completed_at" is null and "matches"."abandoned_at" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "replay_actions" (
	"replay_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"actor_slot_id" text NOT NULL,
	"action" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replay_actions_replay_sequence_pk" PRIMARY KEY("replay_id","sequence"),
	CONSTRAINT "replay_actions_sequence_positive" CHECK ("replay_actions"."sequence" > 0),
	CONSTRAINT "replay_actions_actor_not_empty" CHECK (length("replay_actions"."actor_slot_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "replays" (
	"id" text PRIMARY KEY NOT NULL,
	"replay_format_version" integer NOT NULL,
	"game_id" text NOT NULL,
	"game_version" text NOT NULL,
	"rng_algorithm" text NOT NULL,
	"rng_seed" text NOT NULL,
	"initial_config" jsonb NOT NULL,
	"players" jsonb NOT NULL,
	"recorded_rng_cursor" bigint,
	"recorded_outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "replays_id_not_empty" CHECK (length("replays"."id") > 0),
	CONSTRAINT "replays_format_version_positive" CHECK ("replays"."replay_format_version" > 0),
	CONSTRAINT "replays_game_id_not_empty" CHECK (length("replays"."game_id") > 0),
	CONSTRAINT "replays_game_version_not_empty" CHECK (length("replays"."game_version") > 0),
	CONSTRAINT "replays_rng_algorithm_not_empty" CHECK (length("replays"."rng_algorithm") > 0),
	CONSTRAINT "replays_rng_seed_not_empty" CHECK (length("replays"."rng_seed") > 0),
	CONSTRAINT "replays_completion_consistent" CHECK ((
        ("replays"."completed_at" is null and "replays"."recorded_rng_cursor" is null and "replays"."recorded_outcome" is null)
        or
        ("replays"."completed_at" is not null and "replays"."recorded_rng_cursor" >= 0 and "replays"."recorded_outcome" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_created_at_valid" CHECK ("users"."created_at" <= now())
);
--> statement-breakpoint
ALTER TABLE "guest_user_associations" ADD CONSTRAINT "guest_user_associations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_replay_id_replays_id_fk" FOREIGN KEY ("replay_id") REFERENCES "public"."replays"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_actions" ADD CONSTRAINT "replay_actions_replay_id_replays_id_fk" FOREIGN KEY ("replay_id") REFERENCES "public"."replays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_user_associations_user_idx" ON "guest_user_associations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "match_players_session_history_idx" ON "match_players" USING btree ("player_session_id","match_id");--> statement-breakpoint
CREATE INDEX "match_players_user_history_idx" ON "match_players" USING btree ("user_id","match_id");--> statement-breakpoint
CREATE INDEX "matches_history_order_idx" ON "matches" USING btree ("created_at","id");