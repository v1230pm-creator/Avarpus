CREATE TABLE IF NOT EXISTS "status_updates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "body" text,
  "object_path" text,
  "mime_type" text,
  "size_bytes" integer,
  "audience" text DEFAULT 'contacts' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_updates_author_created_idx"
  ON "status_updates" ("author_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_updates_active_expiry_idx"
  ON "status_updates" ("expires_at", "deleted_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "status_viewers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status_id" uuid NOT NULL REFERENCES "status_updates"("id") ON DELETE CASCADE,
  "viewer_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "viewed_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "status_viewers_status_user_unique"
  ON "status_viewers" ("status_id", "viewer_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_viewers_status_viewed_idx"
  ON "status_viewers" ("status_id", "viewed_at");