ALTER TABLE "repairs" ADD COLUMN "device_condition" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "diagnosis" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "work_performed" text;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "repair_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repairs" ADD COLUMN "repair_completed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "repair_returns" SET "status" = CASE "status"
  WHEN 'return_received' THEN 'returned'
  WHEN 'rework_approved' THEN 'rework_required'
  WHEN 'in_repair' THEN 'rework_required'
  WHEN 'ready' THEN 'repaired'
  WHEN 'delivered' THEN 'repaired'
  ELSE "status" END
WHERE "status" IN ('return_received','rework_approved','in_repair','ready','delivered');
