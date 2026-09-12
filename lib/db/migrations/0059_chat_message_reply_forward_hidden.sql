ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "reply_to_message_id" uuid
    REFERENCES "chat_messages"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "forwarded" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_message_hidden" (
  "message_id" uuid NOT NULL
    REFERENCES "chat_messages"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL
    REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_message_hidden_message_user_unique"
  ON "chat_message_hidden" ("message_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_message_hidden_user_idx"
  ON "chat_message_hidden" ("user_id");
