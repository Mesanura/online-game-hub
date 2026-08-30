ALTER TABLE "matches" DROP CONSTRAINT "matches_runtime_room_id_unique";--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "round_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_runtime_room_round_unique" UNIQUE("runtime_room_id","round_number");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_round_number_positive" CHECK ("matches"."round_number" > 0);