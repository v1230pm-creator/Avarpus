CREATE TABLE IF NOT EXISTS "chat_blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "blocker_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "blocked_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "chat_blocks_blocker_blocked_unique"
  ON "chat_blocks" ("blocker_user_id", "blocked_user_id");
CREATE INDEX IF NOT EXISTS "chat_blocks_blocked_user_idx"
  ON "chat_blocks" ("blocked_user_id");
ALTER TABLE "chat_blocks" DROP CONSTRAINT IF EXISTS "chat_blocks_not_self";
ALTER TABLE "chat_blocks" ADD CONSTRAINT "chat_blocks_not_self"
  CHECK ("blocker_user_id" <> "blocked_user_id");

CREATE TABLE IF NOT EXISTS "chat_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reporter_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reported_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "room_id" uuid NOT NULL REFERENCES "chat_rooms"("id") ON DELETE CASCADE,
  "message_id" uuid REFERENCES "chat_messages"("id") ON DELETE SET NULL,
  "reason" text NOT NULL,
  "details" text,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "chat_reports_room_created_idx"
  ON "chat_reports" ("room_id", "created_at");
CREATE INDEX IF NOT EXISTS "chat_reports_status_created_idx"
  ON "chat_reports" ("status", "created_at");