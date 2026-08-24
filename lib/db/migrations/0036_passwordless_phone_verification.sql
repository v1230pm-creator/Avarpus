CREATE TABLE IF NOT EXISTS "phone_verification_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "phone_number" text NOT NULL,
  "challenge_hash" text NOT NULL UNIQUE,
  "status_token_hash" text NOT NULL UNIQUE,
  "device_id" text,
  "device_public_key" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "failure_code" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "verified_at" timestamp with time zone,
  "session_issued_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "phone_verification_challenges_status_idx"
  ON "phone_verification_challenges" ("status", "expires_at");
CREATE INDEX IF NOT EXISTS "phone_verification_challenges_phone_idx"
  ON "phone_verification_challenges" ("phone_number", "created_at");

CREATE TABLE IF NOT EXISTS "sms_verification_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gateway_message_id" text NOT NULL UNIQUE,
  "sender_number" text NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "sms_verification_events_gateway_id_idx"
  ON "sms_verification_events" ("gateway_message_id");

CREATE TABLE IF NOT EXISTS "user_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "device_id" text NOT NULL,
  "public_key" text NOT NULL,
  "algorithm" text DEFAULT 'RSA-SHA256' NOT NULL,
  "is_revoked" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_devices_user_device_idx"
  ON "user_devices" ("user_id", "device_id");
CREATE INDEX IF NOT EXISTS "user_devices_device_lookup_idx"
  ON "user_devices" ("device_id", "is_revoked");

CREATE TABLE IF NOT EXISTS "device_auth_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "device_id" text NOT NULL,
  "challenge_hash" text NOT NULL UNIQUE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "device_auth_challenges_expiry_idx"
  ON "device_auth_challenges" ("expires_at");