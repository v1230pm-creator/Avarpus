---
name: drizzle-kit generate config quirk
description: Migration generation fails with the checked-in drizzle.config.ts; use a relative-path config.
---

`npx drizzle-kit generate` with `lib/db/drizzle.config.ts` fails (ENOENT `.//home/...`) because the config uses absolute `__dirname` paths that drizzle-kit concatenates wrongly. In this environment, generated journal `when` values can also be earlier than the latest checked-in entry, causing runtime migration discovery to skip the new migration.

**Why:** Hit when adding the business tables migration; the checked-in config only works for `migrate()` at runtime, not `generate`.

**How to apply:** From `lib/db`, run generate against a temporary config with relative `schema: "./src/schema/index.ts"` and `out: "./migrations"`. Verify generated SQL contains only the intended delta and its journal `when` is greater than the current final entry; correct it before restarting the API server, which applies migrations on boot.
