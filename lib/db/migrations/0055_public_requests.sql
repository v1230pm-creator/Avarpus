CREATE TABLE IF NOT EXISTS "public_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "requester_name" text NOT NULL,
  "mobile" text NOT NULL,
  "email" text,
  "subject" text,
  "message" text NOT NULL,
  "status" text DEFAULT 'received' NOT NULL,
  "ip_hash" text NOT NULL,
  "confirmation_accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "public_requests_ip_created_idx"
  ON "public_requests" USING btree ("ip_hash", "created_at");
CREATE INDEX IF NOT EXISTS "public_requests_kind_status_idx"
  ON "public_requests" USING btree ("kind", "status", "created_at");
CREATE INDEX IF NOT EXISTS "public_requests_mobile_created_idx"
  ON "public_requests" USING btree ("mobile", "created_at");