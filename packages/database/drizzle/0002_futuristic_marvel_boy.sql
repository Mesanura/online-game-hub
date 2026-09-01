CREATE TABLE "account_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "account_sessions_token_hash_format" CHECK ("account_sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "account_sessions_expiry_valid" CHECK ("account_sessions"."expires_at" > "account_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "password_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_credentials_username_format" CHECK ("password_credentials"."username" ~ '^[a-z0-9_]{3,24}$'),
	CONSTRAINT "password_credentials_hash_length" CHECK (length("password_credentials"."password_hash") between 1 and 1024),
	CONSTRAINT "password_credentials_timestamps_valid" CHECK ("password_credentials"."created_at" <= "password_credentials"."updated_at" and "password_credentials"."updated_at" <= now())
);
--> statement-breakpoint
ALTER TABLE "account_sessions" ADD CONSTRAINT "account_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_sessions_token_hash_unique" ON "account_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "account_sessions_user_expiry_idx" ON "account_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_credentials_username_unique" ON "password_credentials" USING btree ("username");