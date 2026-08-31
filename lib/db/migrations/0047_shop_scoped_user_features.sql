ALTER TABLE "user_feature_settings"
  DROP CONSTRAINT IF EXISTS "user_feature_settings_pkey";
--> statement-breakpoint
ALTER TABLE "user_feature_settings"
  ADD CONSTRAINT "user_feature_settings_pkey" PRIMARY KEY ("user_id", "shop_id");
--> statement-breakpoint
ALTER TABLE "shop_memberships"
  DROP COLUMN IF EXISTS "permissions";