ALTER TABLE "public_requests"
  ADD COLUMN IF NOT EXISTS "reviewer_user_id" uuid
    REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "public_requests"
  ADD CONSTRAINT "public_requests_status_check"
    CHECK ("status" IN ('received', 'in_review', 'resolved', 'rejected'));

CREATE INDEX IF NOT EXISTS "public_requests_status_created_idx"
  ON "public_requests" USING btree ("status", "created_at", "id");

CREATE TABLE IF NOT EXISTS "public_request_transitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "public_request_id" uuid NOT NULL
    REFERENCES "public_requests"("id") ON DELETE RESTRICT,
  "from_status" text NOT NULL,
  "to_status" text NOT NULL,
  "note" text,
  "reviewer_user_id" uuid NOT NULL
    REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "public_request_transitions_from_status_check"
    CHECK ("from_status" IN ('received', 'in_review', 'resolved', 'rejected')),
  CONSTRAINT "public_request_transitions_to_status_check"
    CHECK ("to_status" IN ('received', 'in_review', 'resolved', 'rejected')),
  CONSTRAINT "public_request_transitions_status_change_check"
    CHECK ("from_status" <> "to_status")
);

CREATE INDEX IF NOT EXISTS "public_request_transitions_request_created_idx"
  ON "public_request_transitions" USING btree ("public_request_id", "created_at");
CREATE INDEX IF NOT EXISTS "public_request_transitions_reviewer_created_idx"
  ON "public_request_transitions" USING btree ("reviewer_user_id", "created_at");

CREATE TABLE IF NOT EXISTS "public_request_identity_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "public_request_id" uuid NOT NULL UNIQUE
    REFERENCES "public_requests"("id") ON DELETE RESTRICT,
  "reviewer_user_id" uuid NOT NULL
    REFERENCES "users"("id") ON DELETE RESTRICT,
  "method" text NOT NULL,
  "note" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "public_request_identity_verifications_reviewer_created_idx"
  ON "public_request_identity_verifications" USING btree ("reviewer_user_id", "created_at");

CREATE OR REPLACE FUNCTION "public_request_audit_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.allow_public_request_audit_cleanup', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'public request audit records are append-only';
END;
$$;

CREATE TRIGGER "public_request_transitions_append_only"
  BEFORE UPDATE OR DELETE ON "public_request_transitions"
  FOR EACH ROW EXECUTE FUNCTION "public_request_audit_append_only"();

CREATE TRIGGER "public_request_identity_verifications_append_only"
  BEFORE UPDATE OR DELETE ON "public_request_identity_verifications"
  FOR EACH ROW EXECUTE FUNCTION "public_request_audit_append_only"();