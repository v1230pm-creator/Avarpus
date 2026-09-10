---
name: Expo simulator API routing
description: Expo Go normally shares the production API for account/data parity; use the explicit local-API script only when testing unpublished backend changes.
---

The normal Expo Go workflow and EAS release builds use the verified production
API custom domain so the same login sees the same shop and records. An explicit
local-API development script switches Expo Go to the current Replit development
domain when testing backend changes that have not been published.

**Why:** using the temporary development API during ordinary Expo Go testing
creates a separate account/data universe from the installed app. Conversely,
unpublished backend work cannot be validated against production. The explicit
mode split makes the selected data environment intentional. The production
origin must be the verified custom domain, never a stale generated deployment
hostname.

**How to apply:** use the normal mobile workflow to reproduce what users see in
the installed app. Use the local-API script only while developing server/auth
changes, and confirm those requests in the development API workflow logs.