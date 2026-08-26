-- Trusted-device records are immutable generations. An old session can only
-- revoke the generation it was created with, never a renewed trust.
DROP INDEX IF EXISTS "trusted_device_trusts_user_android_hash_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "trusted_device_trusts_active_user_android_hash_idx"
  ON "trusted_device_trusts" ("user_id", "android_id_hash") WHERE "revoked_at" IS NULL;

CREATE TABLE IF NOT EXISTS "trusted_device_recovery_rate_limits" (
  "key_hash" text PRIMARY KEY NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "trusted_device_recovery_rate_limits_expires_idx"
  ON "trusted_device_recovery_rate_limits" ("expires_at");