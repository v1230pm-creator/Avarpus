-- Migration 0026: one-to-one room dedupe + idempotent message send.
--   * chat_rooms.peer_key  — deterministic sorted pair of participant user IDs
--   * chat_messages.client_request_id — client idempotency key for send
--   * unique index (shop_id, peer_key)  where peer_key is not null
--   * unique index (room_id, sender_id, client_request_id) where crid not null
-- Idempotent: safe to apply against a DB where the columns/indexes already exist.

ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "peer_key" text;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "client_request_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_rooms_shop_peer_key_unique"
  ON "chat_rooms" ("shop_id", "peer_key")
  WHERE "peer_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_messages_room_sender_client_req_unique"
  ON "chat_messages" ("room_id", "sender_id", "client_request_id")
  WHERE "client_request_id" IS NOT NULL;
