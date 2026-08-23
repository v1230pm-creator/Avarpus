-- Crash-safe direct-room recovery. Matrix aliases are derived from
-- provision_key, while attempt/lease fields coordinate local workers.
-- Keep this idempotent: development databases may have received schema push
-- before the runtime migration journal catches up.
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "provision_key" text;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "provision_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "provision_lease_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_rooms_provision_key_unique"
  ON "chat_rooms" ("provision_key")
  WHERE "provision_key" IS NOT NULL;