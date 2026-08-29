ALTER TABLE "notifications" ALTER COLUMN "shop_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dedupe_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupe_key_unique"
ON "notifications" ("dedupe_key")
WHERE "dedupe_key" IS NOT NULL;