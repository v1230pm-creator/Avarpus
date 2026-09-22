-- Chat delta sync and delivery receipts.
--
-- Change tracking on messages: a database-assigned watermark bumped on every
-- shared-row change a device must learn about (tombstone, edit, media relay
-- state), plus the media relay state used by the temporary-relay clean-up
-- (always `available` until that ships). Existing rows are backfilled with
-- their own created_at so historical messages do not surface as "changed" in
-- the initial sync window: the column is added nullable, backfilled, and only
-- then given its NOT NULL + DEFAULT now() shape.
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "media_state" text NOT NULL DEFAULT 'available';
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "media_pinned" boolean NOT NULL DEFAULT false;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz;
UPDATE "chat_messages" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "chat_messages" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "chat_messages" ALTER COLUMN "updated_at" SET NOT NULL;

-- Keyset paging for delta sync: per room and per account.
CREATE INDEX IF NOT EXISTS "chat_messages_room_updated_idx" ON "chat_messages" ("room_id", "updated_at", "id");
CREATE INDEX IF NOT EXISTS "chat_messages_updated_idx" ON "chat_messages" ("updated_at", "id");

-- Per-message delivery receipts: one row per (message, recipient), written by
-- explicit client acks and by the read marker (read implies delivered).
-- Timestamps are first-seen and database-assigned.
CREATE TABLE IF NOT EXISTS "chat_message_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "message_id" uuid NOT NULL REFERENCES "chat_messages"("id") ON DELETE CASCADE,
  "room_id" uuid NOT NULL REFERENCES "chat_rooms"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "delivered_at" timestamptz NOT NULL DEFAULT now(),
  "stored_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "chat_message_receipts_message_user_unique" ON "chat_message_receipts" ("message_id", "user_id");
CREATE INDEX IF NOT EXISTS "chat_message_receipts_updated_idx" ON "chat_message_receipts" ("updated_at", "id");
CREATE INDEX IF NOT EXISTS "chat_message_receipts_room_user_idx" ON "chat_message_receipts" ("room_id", "user_id");

-- Delta sync streams for caller-specific changes.
CREATE INDEX IF NOT EXISTS "chat_message_hidden_user_created_idx" ON "chat_message_hidden" ("user_id", "created_at", "message_id");
CREATE INDEX IF NOT EXISTS "chat_read_state_last_read_idx" ON "chat_read_state" ("last_read_at", "id");
