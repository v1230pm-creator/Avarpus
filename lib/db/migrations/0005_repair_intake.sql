CREATE TABLE "repair_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"repair_id" uuid NOT NULL,
	"user_id" uuid,
	"user_name" text NOT NULL,
	"user_role" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repair_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"repair_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"object_path" text NOT NULL,
	"uploaded_by_id" uuid,
	"uploaded_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "checklist" jsonb;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "receiving_signature_path" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "delivery_signature_path" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "warranty_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "warranty_expiry" text;--> statement-breakpoint
ALTER TABLE "repair_events" ADD CONSTRAINT "repair_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_events" ADD CONSTRAINT "repair_events_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_photos" ADD CONSTRAINT "repair_photos_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_photos" ADD CONSTRAINT "repair_photos_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE cascade ON UPDATE no action;