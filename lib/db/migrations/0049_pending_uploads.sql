CREATE TABLE "pending_uploads" (
	"object_path" text PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"claim_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pending_uploads_owner_purpose_idx" ON "pending_uploads" USING btree ("owner_user_id","purpose");
--> statement-breakpoint
CREATE INDEX "pending_uploads_cleanup_idx" ON "pending_uploads" USING btree ("created_at","claim_until");