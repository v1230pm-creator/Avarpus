CREATE TABLE "otp_verification_rate_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "otp_verification_rate_limits_expires_idx" ON "otp_verification_rate_limits" USING btree ("expires_at");--> statement-breakpoint