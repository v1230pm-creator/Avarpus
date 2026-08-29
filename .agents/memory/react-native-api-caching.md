---
name: React Native API caching
description: Why dynamic and authenticated API responses must avoid HTTP validators in the mobile app.
---

Dynamic and authenticated API responses must disable HTTP caching and ETag validation. Let React Query own application-level caching.

**Why:** React Native can issue conditional requests from its native fetch cache. Express then returns a body-less `304 Not Modified`, but the generated API client treats non-2xx responses as errors, producing misleading network-error states despite a healthy server.

**How to apply:** Keep API responses `Cache-Control: no-store` and do not re-enable Express ETags globally. If a specific public download needs caching, set its cache policy explicitly at that route.