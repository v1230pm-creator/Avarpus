-- Signed Resend webhook receipts. Keep only safe delivery metadata; email
-- content and verification codes are intentionally never persisted here.
CREATE TABLE IF NOT EXISTS "resend_webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider_event_id" text NOT NULL,
  "resend_email_id" text,
  "event_type" text NOT NULL,
  "recipient" text NOT NULL,
  "failure_reason" text,
  "shop_id" uuid,
  "occurred_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "resend_webhook_events"
    ADD CONSTRAINT "resend_webhook_events_shop_id_shops_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resend_webhook_events_provider_event_id_unique"
  ON "resend_webhook_events" ("provider_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resend_webhook_events_shop_occurred_idx"
  ON "resend_webhook_events" ("shop_id", "occurred_at");