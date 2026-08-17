---
name: Prod data import path
description: How to move shop data from dev DB into production (read-only prod SQL) and node-postgres jsonb array pitfall
---
Production DB is read-only via executeSql; the supported write path is the token-guarded POST /api/sync/import-bundle endpoint (dormant 404 unless IMPORT_BUNDLE_TOKEN env is set in prod) driven by artifacts/api-server/scripts/sync-to-prod.mjs. Inserts are ON CONFLICT DO NOTHING, shop-scoped, rerun-safe.
**Why:** one-time Expo Go (dev DB) -> production merge; token was set temporarily via setEnvVars and deleted after.
**How to apply:** re-set a fresh token in prod env, republish if endpoint changed, run the script, delete the token.
**Pitfall:** node-postgres serializes JS arrays as Postgres array literals, which jsonb columns reject — JSON.stringify array values before parameterized insert into jsonb (objects are fine).
