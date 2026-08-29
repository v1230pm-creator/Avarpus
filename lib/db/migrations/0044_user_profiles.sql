ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "profile_about" text,
  ADD COLUMN IF NOT EXISTS "profile_username" text,
  ADD COLUMN IF NOT EXISTS "profile_links" jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_profile_username_unique"
ON "users" ("profile_username")
WHERE "profile_username" IS NOT NULL;