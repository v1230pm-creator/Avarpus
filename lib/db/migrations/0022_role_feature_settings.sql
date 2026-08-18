CREATE TABLE IF NOT EXISTS "role_feature_settings" (
	"shop_id" uuid NOT NULL,
	"role" text NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_feature_settings_shop_id_role_pk" PRIMARY KEY("shop_id","role")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_feature_settings" ADD CONSTRAINT "role_feature_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
