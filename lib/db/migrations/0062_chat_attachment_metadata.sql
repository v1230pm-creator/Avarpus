-- Chat attachments of any file type: store the object's verified MIME type and
-- byte size so clients can render/open them correctly and the media endpoint
-- can set a safe Content-Type / Content-Disposition. Also introduces the
-- "video" message kind (existing rows are untouched).
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "mime_type" text;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "size_bytes" bigint;
