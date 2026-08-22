-- Migration 0027: voice-note (audio) support for chat messages.
--   * chat_messages.duration_ms integer (nullable) — voice-note duration in ms
--   * If a chat_message_kind Postgres enum ever exists, add the 'audio' value.
--
-- Note: chat_messages.kind is currently a plain text column (see 0025), so the
-- 'audio' kind is already accepted at the storage layer and enforced at the API
-- layer. The conditional ALTER TYPE below is a forward-compatible no-op today
-- and safely extends the enum should one be introduced in the future.
-- Idempotent: safe to apply against a DB where the column/value already exist.

ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "duration_ms" integer;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_message_kind') THEN
    ALTER TYPE "chat_message_kind" ADD VALUE IF NOT EXISTS 'audio';
  END IF;
END $$;
