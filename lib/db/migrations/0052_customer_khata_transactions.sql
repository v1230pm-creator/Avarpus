CREATE TABLE IF NOT EXISTS "customer_khata_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE cascade,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE cascade,
  "direction" text NOT NULL,
  "amount" double precision NOT NULL,
  "note" text,
  "method" text DEFAULT 'Cash' NOT NULL,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_by_name" text,
  "client_request_id" text,
  "book_date" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_khata_transactions_shop_client_request_id_unique"
  ON "customer_khata_transactions" USING btree ("shop_id", "customer_id", "client_request_id")
  WHERE "client_request_id" IS NOT NULL;