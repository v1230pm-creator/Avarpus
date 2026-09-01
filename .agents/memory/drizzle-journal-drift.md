---
name: Database schema ownership
description: Schema push and Publish own database changes; API startup must not replay migration files.
---

Do not run Drizzle migrations from the API process at startup. Development schema is applied by the project schema-push flow, and production schema is applied by Replit Publish.

**Why:** Schema push and Publish can produce the current schema without matching migration-journal rows. Startup migration then replays historical SQL against a later schema: it may fail on already-existing objects, reference columns that later migrations removed, or block the deployment health-check timeout.

**How to apply:** Keep schema changes in the Drizzle schema source. Use the established development schema-push/post-merge flow, then let Publish apply the development-to-production diff. API startup should open its port without issuing DDL.
