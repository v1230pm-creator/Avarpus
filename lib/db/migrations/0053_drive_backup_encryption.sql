ALTER TABLE "drive_backup_settings"
  ADD COLUMN IF NOT EXISTS "encryption_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "drive_backup_settings"
  ADD COLUMN IF NOT EXISTS "recovery_password_salt" text;
--> statement-breakpoint
ALTER TABLE "drive_backup_settings"
  ADD COLUMN IF NOT EXISTS "recovery_password_verifier" text;