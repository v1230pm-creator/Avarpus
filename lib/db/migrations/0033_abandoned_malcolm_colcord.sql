ALTER TABLE "otp_verification_rate_limits" ADD COLUMN "in_flight_token" text;--> statement-breakpoint
ALTER TABLE "otp_verification_rate_limits" ADD COLUMN "in_flight_until" timestamp with time zone;