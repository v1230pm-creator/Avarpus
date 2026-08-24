---
name: Static web API bootstrapping
description: Prevent static-hosted Avarpus web sessions from making their first requests against the frontend origin.
---

Configure the shared API base URL and bearer-token getter synchronously before any generated React Query hook can render. Production static builds must require an explicit public API origin rather than silently falling back to the static website origin.

**Why:** an effect-based configuration runs after the first authenticated query. On a restored session, that first request can go to the static host without credentials, fail once, and incorrectly sign the user out.

**How to apply:** when adding browser entrypoints that use `@workspace/api-client-react`, initialize its base URL/token getter at module bootstrap and make the production build fail without its `VITE_API_URL` (or equivalent public API-origin setting).