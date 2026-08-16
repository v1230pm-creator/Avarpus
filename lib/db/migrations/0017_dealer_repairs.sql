CREATE TABLE IF NOT EXISTS "dealers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"dealer_code" text NOT NULL,
	"name" text NOT NULL,
	"shop_name" text,
	"mobile" text NOT NULL,
	"location" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dealers" ADD CONSTRAINT "dealers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dealers_shop_code_unique" ON "dealers" ("shop_id","dealer_code");
--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN IF NOT EXISTS "dealer_id" uuid;
--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN IF NOT EXISTS "dealer_name" text;
--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN IF NOT EXISTS "created_by_id" uuid;
--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN IF NOT EXISTS "created_by_name" text;
--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN IF NOT EXISTS "updated_by_id" uuid;
--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN IF NOT EXISTS "updated_by_name" text;
--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repairs" ADD CONSTRAINT "repairs_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "dealer_id" uuid;
