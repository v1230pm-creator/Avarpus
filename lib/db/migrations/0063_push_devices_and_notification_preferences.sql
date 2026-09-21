-- Push devices: one account may hold several live devices. Record the device's
-- own installation identity, the app build it runs, whether it currently
-- accepts notifications, and delivery bookkeeping for the diagnostics screen.
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "device_id" text;
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "app_version" text;
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "notifications_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "last_sent_at" timestamptz;
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "last_error" text;
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "last_error_at" timestamptz;
CREATE INDEX IF NOT EXISTS "push_tokens_user_device_idx" ON "push_tokens" ("user_id", "device_id");

-- Per-account notification preferences, applied server-side at send time.
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "messages" boolean NOT NULL DEFAULT true,
  "calls" boolean NOT NULL DEFAULT true,
  "dealer" boolean NOT NULL DEFAULT true,
  "repair" boolean NOT NULL DEFAULT true,
  "payments" boolean NOT NULL DEFAULT true,
  "status" boolean NOT NULL DEFAULT true,
  "show_preview" boolean NOT NULL DEFAULT true,
  "sound" boolean NOT NULL DEFAULT true,
  "vibration" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
