CREATE TABLE IF NOT EXISTS "chat_contact_match_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "caller_user_id" uuid NOT NULL,
  "target_user_id" uuid NOT NULL,
  "shop_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_contact_match_grants_token_hash_unique" UNIQUE("token_hash"),
  CONSTRAINT "chat_contact_match_grants_caller_user_id_users_id_fk" FOREIGN KEY ("caller_user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "chat_contact_match_grants_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "chat_contact_match_grants_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_contact_match_grants_lookup_idx" ON "chat_contact_match_grants" USING btree ("token_hash","caller_user_id","target_user_id","shop_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_contact_match_grants_expires_idx" ON "chat_contact_match_grants" USING btree ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_contact_match_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "ip_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_contact_match_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_contact_match_attempts_user_created_idx" ON "chat_contact_match_attempts" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_contact_match_attempts_ip_created_idx" ON "chat_contact_match_attempts" USING btree ("ip_hash","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_contact_match_attempts_created_idx" ON "chat_contact_match_attempts" USING btree ("created_at");