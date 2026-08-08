CREATE TABLE "customer_otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"target_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"repair_id" uuid NOT NULL,
	"old_amount" double precision NOT NULL,
	"new_amount" double precision NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"method" text,
	"signature_path" text,
	"requested_by_id" uuid,
	"requested_by_name" text,
	"decided_by_id" uuid,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repair_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"repair_id" uuid NOT NULL,
	"customer_id" uuid,
	"amount" double precision NOT NULL,
	"method" text DEFAULT 'Cash' NOT NULL,
	"kind" text DEFAULT 'advance' NOT NULL,
	"note" text,
	"reference_no" text,
	"received_by_id" uuid,
	"received_by_name" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"inventory_item_id" uuid,
	"item_name" text NOT NULL,
	"quantity_change" integer NOT NULL,
	"reason" text NOT NULL,
	"repair_id" uuid,
	"return_id" uuid,
	"by_id" uuid,
	"by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "imei2" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "serial_number" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "storage" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "ram" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "device_password" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "sim_present" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "memory_card_present" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "accessories_list" jsonb;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "physical_condition" jsonb;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "assigned_by_id" uuid;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "assigned_by_name" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "service_charge" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "other_charge" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "discount" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "tax_percent" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "testing_checklist" jsonb;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "testing_confirmed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "testing_confirmed_by_name" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "testing_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "customer_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "client_request_id" text;--> statement-breakpoint
ALTER TABLE "customer_otp_codes" ADD CONSTRAINT "customer_otp_codes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_approvals" ADD CONSTRAINT "estimate_approvals_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_approvals" ADD CONSTRAINT "estimate_approvals_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_payments" ADD CONSTRAINT "repair_payments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_payments" ADD CONSTRAINT "repair_payments_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_payments" ADD CONSTRAINT "repair_payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repairs_shop_client_request_id_unique" ON "repairs" USING btree ("shop_id","client_request_id") WHERE "repairs"."client_request_id" IS NOT NULL;--> statement-breakpoint
-- Backfill: preserve existing advances as ledger rows (append-only source of truth)
INSERT INTO "repair_payments" ("shop_id","repair_id","customer_id","amount","method","kind","note","is_sample","created_at")
SELECT "shop_id","id","customer_id","advance",COALESCE("payment_method",'Cash'),'advance','Migrated from legacy advance field',"is_sample","created_at"
FROM "repairs" WHERE "advance" > 0;
