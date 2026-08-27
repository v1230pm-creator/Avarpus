ALTER TABLE "chat_reports" ADD COLUMN "client_request_id" text;
UPDATE "chat_reports"
SET "client_request_id" = 'legacy-' || "id"::text
WHERE "client_request_id" IS NULL;
ALTER TABLE "chat_reports" ALTER COLUMN "client_request_id" SET NOT NULL;
CREATE UNIQUE INDEX "chat_reports_reporter_client_req_unique"
ON "chat_reports" USING btree ("reporter_user_id", "client_request_id");