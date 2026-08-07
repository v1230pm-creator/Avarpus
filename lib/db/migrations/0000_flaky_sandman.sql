CREATE TABLE IF NOT EXISTS "otp_codes" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"identifier" text NOT NULL,
"purpose" text NOT NULL,
"code_hash" text NOT NULL,
"payload" jsonb,
"attempts" integer DEFAULT 0 NOT NULL,
"consumed_at" timestamp with time zone,
"expires_at" timestamp with time zone NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
"token" text PRIMARY KEY NOT NULL,
"user_id" uuid NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"name" text NOT NULL,
"email" text NOT NULL,
"mobile" text NOT NULL,
"password_hash" text NOT NULL,
"role" text DEFAULT 'reception' NOT NULL,
"is_active" boolean DEFAULT false NOT NULL,
"designation" text,
"join_date" text,
"business_name" text,
"gst_number" text,
"shop_address" text,
"profile_photo" text,
"company_logo" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
CONSTRAINT "users_email_unique" UNIQUE("email"),
CONSTRAINT "users_mobile_unique" UNIQUE("mobile")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sessions_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
