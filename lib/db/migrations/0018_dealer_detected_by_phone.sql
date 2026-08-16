ALTER TABLE "repairs" ADD COLUMN IF NOT EXISTS "dealer_detected_by_phone" boolean DEFAULT false NOT NULL;
