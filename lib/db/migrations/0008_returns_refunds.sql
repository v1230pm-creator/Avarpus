CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"repair_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"customer_id" uuid,
	"amount" double precision NOT NULL,
	"original_paid" double precision DEFAULT 0 NOT NULL,
	"method" text DEFAULT 'Cash' NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"reason" text NOT NULL,
	"reference_no" text,
	"requested_by_id" uuid,
	"requested_by_name" text,
	"approved_by_id" uuid,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"paid_by_id" uuid,
	"paid_by_name" text,
	"paid_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repair_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"return_id" text NOT NULL,
	"repair_id" uuid NOT NULL,
	"customer_id" uuid,
	"status" text DEFAULT 'return_received' NOT NULL,
	"return_date" text NOT NULL,
	"days_after_delivery" integer,
	"reason" text NOT NULL,
	"complaint" text NOT NULL,
	"device_condition" text,
	"under_warranty" boolean DEFAULT false NOT NULL,
	"received_by_id" uuid,
	"received_by_name" text,
	"resolution" text,
	"technician_id" uuid,
	"technician_name" text,
	"diagnosis" text,
	"work_performed" text,
	"parts_cost" double precision DEFAULT 0 NOT NULL,
	"labour_cost" double precision DEFAULT 0 NOT NULL,
	"customer_payable" double precision DEFAULT 0 NOT NULL,
	"notes" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"inventory_item_id" uuid,
	"part_name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_cost" double precision DEFAULT 0 NOT NULL,
	"added_by_id" uuid,
	"added_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_return_id_repair_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."repair_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_returns" ADD CONSTRAINT "repair_returns_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_returns" ADD CONSTRAINT "repair_returns_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_returns" ADD CONSTRAINT "repair_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_parts" ADD CONSTRAINT "return_parts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_parts" ADD CONSTRAINT "return_parts_return_id_repair_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."repair_returns"("id") ON DELETE cascade ON UPDATE no action;