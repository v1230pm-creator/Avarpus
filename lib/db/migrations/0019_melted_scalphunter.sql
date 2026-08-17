ALTER TABLE "repair_payments" ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repair_payments" ADD COLUMN IF NOT EXISTS "voided_by_id" uuid;--> statement-breakpoint
ALTER TABLE "repair_payments" ADD COLUMN IF NOT EXISTS "voided_by_name" text;--> statement-breakpoint
ALTER TABLE "repair_payments" ADD COLUMN IF NOT EXISTS "void_reason" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN IF NOT EXISTS "estimated_cost" double precision;
