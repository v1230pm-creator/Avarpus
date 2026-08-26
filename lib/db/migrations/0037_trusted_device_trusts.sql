CREATE TABLE IF NOT EXISTS "trusted_device_trusts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "android_id_hash" text NOT NULL,
  "device_info" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "recovery_deadline" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "trusted_device_trusts_active_user_android_hash_idx"
  ON "trusted_device_trusts" ("user_id", "android_id_hash") WHERE "revoked_at" IS NULL;
CREATE INDEX IF NOT EXISTS "trusted_device_trusts_hash_active_idx"
  ON "trusted_device_trusts" ("android_id_hash", "expires_at");
ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "trusted_device_id" uuid REFERENCES "trusted_device_trusts"("id") ON DELETE SET NULL;