-- Chat media relay purge history.
--
-- One row per whole-relay purge run (daily timer and operator "Run now") so
-- the console can show a trend instead of only the last summary kept in
-- app_settings: bytes reclaimed per day, purged (every recipient stored it)
-- versus expired (nobody collected it), and what the relay still held right
-- after each run. Bookkeeping only — no purge decision reads it; the writer
-- is fail-safe and prunes rows past the retention window / row cap.
CREATE TABLE IF NOT EXISTS "chat_relay_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ran_at" timestamptz NOT NULL,
  "trigger" text NOT NULL DEFAULT 'scheduled',
  "skipped" text,
  "grace_days" integer NOT NULL,
  "expiry_days" integer NOT NULL,
  "examined" integer NOT NULL DEFAULT 0,
  "purged" integer NOT NULL DEFAULT 0,
  "expired" integer NOT NULL DEFAULT 0,
  "already_gone" integer NOT NULL DEFAULT 0,
  "tombstones_purged" integer NOT NULL DEFAULT 0,
  "kept" integer NOT NULL DEFAULT 0,
  "raced" integer NOT NULL DEFAULT 0,
  "failed" integer NOT NULL DEFAULT 0,
  "bytes_reclaimed" bigint NOT NULL DEFAULT 0,
  "aborted_error" text,
  "held_objects" integer,
  "held_bytes" bigint,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "chat_relay_runs_ran_at_idx" ON "chat_relay_runs" ("ran_at", "id");
