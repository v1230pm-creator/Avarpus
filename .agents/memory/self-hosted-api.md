---
name: Self-hosted API (VPS) portability
description: How the API server runs outside Replit, and the two migration hazards that destroy data if ordered wrong
---
**Rule:** Outside Replit the API uses two env switches: `OBJECT_STORAGE_PROVIDER=gcs` + `GCS_SERVICE_ACCOUNT_KEY_FILE` (plain GCS bucket, local V4 signed URLs) and `RESEND_API_KEY` (direct Resend). Both unset ⇒ Replit sidecar/connector paths. Runbook lives in `deploy/vps/`.

**Why:** Sep 2026 — user chose to move production to a Hostinger VPS with local Postgres 16 (matches Replit's PG 16.10, so plain pg_dump/pg_restore works).

**Hazards (from review):**
- Never start the VPS service against an empty DB while migrated objects exist in the bucket: background cleanup sweeps delete objects the DB does not reference (48h grace). Order = final object copy → DB restore → start service.
- The object migration script must reconcile custom metadata (`custom:aclPolicy`) even when bytes already match; size-only skip is unsafe.
- V4 signed PUT without `contentType` is correct: clients keep sending their own Content-Type. Signed URL is path-style `storage.googleapis.com/<bucket>/<key>`, same as the sidecar, so path normalisation is unchanged.

**Gotcha:** an automatic checkpoint commit once captured a root-level production `*.dump` file; `*.dump`/`*.sql.gz` are now gitignored — check `git show --stat` of checkpoint commits before any GitHub push.
