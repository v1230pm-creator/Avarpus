ALTER TABLE "drive_backup_settings"
  ADD COLUMN IF NOT EXISTS "upload_lease_hash" text;
--> statement-breakpoint
ALTER TABLE "drive_backup_settings"
  ADD COLUMN IF NOT EXISTS "upload_lease_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "drive_backup_settings"
  ALTER COLUMN "automatic_frequency" SET DEFAULT 'never';
--> statement-breakpoint
UPDATE "drive_backup_settings"
  SET "automatic_frequency" = 'never',
      "next_backup_at" = NULL
  WHERE "automatic_frequency" <> 'never' OR "next_backup_at" IS NOT NULL;