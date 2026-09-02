ALTER TABLE "users" ADD COLUMN "display_name" text;--> statement-breakpoint
UPDATE "users" AS users
SET "display_name" = COALESCE(
  (SELECT "username" FROM "password_credentials" WHERE "user_id" = users."id"),
  '游客'
);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "display_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_display_name_length_valid" CHECK (length(trim("users"."display_name")) between 1 and 96);
