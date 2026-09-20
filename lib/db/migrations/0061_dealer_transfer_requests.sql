-- Dealer-to-dealer transfer requests: shop A offers an existing repair row to
-- shop B; B's repair row only comes into existence when B accepts.
ALTER TABLE "repairs" ADD COLUMN IF NOT EXISTS "source_repair_id" uuid;

CREATE TABLE IF NOT EXISTS "dealer_transfer_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE cascade,
  "source_repair_id" uuid NOT NULL REFERENCES "repairs"("id") ON DELETE cascade,
  "source_owner_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "sent_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "sent_by_name" text NOT NULL,
  "receiver_shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE cascade,
  "receiver_owner_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "status" text DEFAULT 'pending' NOT NULL,
  "message" text,
  "result_repair_id" uuid REFERENCES "repairs"("id") ON DELETE set null,
  "responded_by_id" uuid,
  "responded_by_name" text,
  "responded_at" timestamp with time zone,
  "decline_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "dealer_transfer_requests_pending_source_idx"
  ON "dealer_transfer_requests" ("source_repair_id") WHERE "status" = 'pending';
CREATE INDEX IF NOT EXISTS "dealer_transfer_requests_receiver_idx"
  ON "dealer_transfer_requests" ("receiver_shop_id", "status");
CREATE INDEX IF NOT EXISTS "dealer_transfer_requests_source_idx"
  ON "dealer_transfer_requests" ("source_shop_id", "status");
