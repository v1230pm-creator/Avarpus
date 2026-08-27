ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "display_name_completed_at" timestamp with time zone DEFAULT now();

-- Existing named accounts are already complete. Standalone OTP accounts still
-- carrying the generated placeholder should finish onboarding on their next login.
UPDATE "users"
SET "display_name_completed_at" = NULL
WHERE "role" = 'customer'
  AND "name" = 'Customer'
  AND "email" LIKE 'otp-customer-%@standalone.local';