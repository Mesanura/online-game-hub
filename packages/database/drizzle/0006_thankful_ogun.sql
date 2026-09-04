ALTER TABLE "realtime_rooms" DROP CONSTRAINT "realtime_rooms_round_consistent";--> statement-breakpoint
ALTER TABLE "realtime_rooms" ADD COLUMN "current_player_order" jsonb;--> statement-breakpoint
ALTER TABLE "realtime_rooms" ADD CONSTRAINT "realtime_rooms_round_consistent" CHECK ((
        ("realtime_rooms"."current_round_number" is null and "realtime_rooms"."current_replay_id" is null and "realtime_rooms"."current_player_order" is null and "realtime_rooms"."current_status" is null and "realtime_rooms"."current_tick" = 0)
        or
        ("realtime_rooms"."current_round_number" > 0 and "realtime_rooms"."current_replay_id" is not null and "realtime_rooms"."current_player_order" is not null and "realtime_rooms"."current_status" is not null)
      ));