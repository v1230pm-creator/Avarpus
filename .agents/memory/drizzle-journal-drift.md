---
name: Drizzle migration journal drift
description: API server can fail to boot when DB schema was changed out of band but drizzle.__drizzle_migrations wasn't updated.
---

The API server runs drizzle `migrate()` on boot. If schema changes land in the dev DB out of band (e.g. publish/merge-time schema push) without journal rows, boot fails with "relation already exists".

**Why:** Recurring — task-merge reconciliation applies schema to the dev DB without journaling; each merge batch that adds migrations can re-trigger it (`login_events` twice).

**How to apply:** On that error, compare `drizzle.__drizzle_migrations` (hash = sha256 of the SQL file, created_at = `when` from `lib/db/migrations/meta/_journal.json`) against the journal; apply any truly missing DDL idempotently, then backfill the journal rows. Never delete tables to "re-run" migrations.

**Production variant:** Publish flow applies the dev→prod schema diff itself, so on the next deploy the boot-time `migrate()` re-runs the newest migration against a schema that already has it → "already exists" → port 8080 never opens → promote/health-check fails. Prod DB is read-only from the workspace, so the journal cannot be backfilled there — instead make the affected migration idempotent (`ADD COLUMN IF NOT EXISTS` etc.). Prefer writing all new migrations idempotently to avoid this recurring on every publish that includes a new migration.
