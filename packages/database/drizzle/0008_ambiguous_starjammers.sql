ALTER TABLE "realtime_rooms" ADD COLUMN "next_round_setup" jsonb;--> statement-breakpoint
ALTER TABLE "realtime_rooms" ADD COLUMN "previous_finalized_setup" jsonb;--> statement-breakpoint
ALTER TABLE "realtime_rooms" ADD CONSTRAINT "realtime_rooms_setup_state_consistent" CHECK ((
        ("realtime_rooms"."setup_protocol" = 5 and "realtime_rooms"."next_round_setup" is null and "realtime_rooms"."previous_finalized_setup" is null)
        or
        ("realtime_rooms"."setup_protocol" = 6 and (
          ("realtime_rooms"."current_round_number" is null and "realtime_rooms"."next_round_setup" is not null and "realtime_rooms"."previous_finalized_setup" is null)
          or
          ("realtime_rooms"."current_round_number" is not null and "realtime_rooms"."previous_finalized_setup" is not null and (
            ("realtime_rooms"."current_status" = 'completed' and "realtime_rooms"."next_round_setup" is not null)
            or
            ("realtime_rooms"."current_status" in ('active', 'abandoned') and "realtime_rooms"."next_round_setup" is null)
          ))
        ))
      ));