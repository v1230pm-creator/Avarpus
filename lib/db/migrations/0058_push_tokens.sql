CREATE TABLE IF NOT EXISTS "push_tokens" (
  "token" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL
    REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" uuid NOT NULL
    REFERENCES "sessions"("id") ON DELETE CASCADE,
  "platform" text NOT NULL,
  "device_info" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_tokens_user_idx" ON "push_tokens" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_tokens_session_idx" ON "push_tokens" ("session_id");
