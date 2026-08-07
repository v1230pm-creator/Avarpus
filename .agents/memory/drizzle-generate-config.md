---
name: drizzle-kit generate config quirk
description: Migration generation fails with the checked-in drizzle.config.ts; use a relative-path config.
---

`npx drizzle-kit generate` with `lib/db/drizzle.config.ts` fails (ENOENT `.//home/...`) because the config uses absolute `__dirname` paths that drizzle-kit concatenates wrongly.

**Why:** Hit when adding the business tables migration; the checked-in config only works for `migrate()` at runtime, not `generate`.

**How to apply:** From `lib/db`, run generate against a temporary config with relative `schema: "./src/schema/index.ts"` and `out: "./migrations"`. The API server applies migrations on boot, so just restart it after generating.
