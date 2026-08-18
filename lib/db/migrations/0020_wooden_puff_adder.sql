CREATE TABLE IF NOT EXISTS "app_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"build_number" integer NOT NULL,
	"release_date" text,
	"apk_path" text,
	"apk_size" integer,
	"checksum" text,
	"update_type" text DEFAULT 'optional' NOT NULL,
	"min_android_version" text,
	"release_notes" jsonb,
	"screenshots" jsonb,
	"demo_video_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_updates_created_by_users_id_fk') THEN
    ALTER TABLE "app_updates" ADD CONSTRAINT "app_updates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_updates_published_by_users_id_fk') THEN
    ALTER TABLE "app_updates" ADD CONSTRAINT "app_updates_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;