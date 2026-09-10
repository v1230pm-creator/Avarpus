CREATE TABLE IF NOT EXISTS "chat_room_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_id" uuid NOT NULL REFERENCES "chat_rooms"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "is_pinned" boolean DEFAULT false NOT NULL,
  "is_muted" boolean DEFAULT false NOT NULL,
  "is_archived" boolean DEFAULT false NOT NULL,
  "deleted_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_room_preferences_room_user_unique"
  ON "chat_room_preferences" ("room_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_room_preferences_user_inbox_idx"
  ON "chat_room_preferences" ("user_id", "is_archived", "deleted_at");