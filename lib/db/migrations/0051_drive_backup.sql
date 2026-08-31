CREATE TABLE IF NOT EXISTS "drive_backup_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "google_subject" text NOT NULL,
  "email" text NOT NULL,
  "encrypted_refresh_token" text NOT NULL,
  "scopes" text NOT NULL,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "drive_backup_connections_user_unique" ON "drive_backup_connections" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drive_backup_connections_google_subject_idx" ON "drive_backup_connections" USING btree ("google_subject");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_backup_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "automatic_frequency" text DEFAULT 'never' NOT NULL,
  "allow_cellular" boolean DEFAULT false NOT NULL,
  "include_videos" boolean DEFAULT false NOT NULL,
  "backup_file_id" text,
  "last_backup_at" timestamp with time zone,
  "last_backup_size_bytes" text,
  "last_error" text,
  "next_backup_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "drive_backup_settings_user_unique" ON "drive_backup_settings" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drive_backup_settings_next_backup_idx" ON "drive_backup_settings" USING btree ("next_backup_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_backup_oauth_states" (
  "state_hash" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drive_backup_oauth_states_expires_idx" ON "drive_backup_oauth_states" USING btree ("expires_at");