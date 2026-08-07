ALTER TABLE "login_events" ADD COLUMN "device_info" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_info" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_id_unique" UNIQUE("id");