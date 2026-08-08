CREATE TABLE "repair_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"repair_id" uuid NOT NULL,
	"inventory_item_id" uuid,
	"part_name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_cost" double precision DEFAULT 0 NOT NULL,
	"added_by_id" uuid,
	"added_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "alternate_mobile" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "accessories" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "received_by_id" uuid;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "received_by_name" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "delivered_by_id" uuid;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "delivered_by_name" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "repair_parts" ADD CONSTRAINT "repair_parts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_parts" ADD CONSTRAINT "repair_parts_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE cascade ON UPDATE no action;