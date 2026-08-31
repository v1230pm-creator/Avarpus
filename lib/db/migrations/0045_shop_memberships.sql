CREATE TABLE IF NOT EXISTS "shop_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text DEFAULT 'staff' NOT NULL,
  "staff_id" text,
  "status" text DEFAULT 'active' NOT NULL,
  "permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "invite_code_hash" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "business_email" text,
  ADD COLUMN IF NOT EXISTS "business_email_verified_at" timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shop_memberships_shop_user_unique"
  ON "shop_memberships" ("shop_id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shop_memberships_shop_staff_id_unique"
  ON "shop_memberships" ("shop_id", "staff_id")
  WHERE "staff_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_memberships_user_status_idx"
  ON "shop_memberships" ("user_id", "status");
--> statement-breakpoint
INSERT INTO "shop_memberships" ("shop_id", "user_id", "role", "status", "permissions")
SELECT
  u."shop_id",
  u."id",
  CASE WHEN u."role" IN ('dealer', 'super_admin') THEN 'owner' ELSE u."role" END,
  'active',
  CASE WHEN u."role" IN ('dealer', 'super_admin') THEN '{"*":true}'::jsonb ELSE '{}'::jsonb END
FROM "users" u
INNER JOIN "shops" s ON s."id" = u."shop_id"
ON CONFLICT ("shop_id", "user_id") DO NOTHING;