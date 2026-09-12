---
name: Paginated shared lists vs by-id screens
description: Why mobile detail screens must never depend on the bulk DataContext list containing a row, and how the list must be loaded
---
- The `/repairs` list endpoint is paginated (default 50, max 200) and, except for the received-only tab, ordered oldest-first. Calling it with no params returns the 50 OLDEST rows — every newer repair is silently missing.
- **Why:** the mobile DataContext did exactly that; once a shop passed 50 repairs, every new ticket opened from a notification/list showed "Repair not found" and reports/intake saw stale data. Production shop had 77 rows when this surfaced (Sep 2026).
- **How to apply:**
  - Bulk loaders in DataContext must walk every page (`fetchAllRepairs`, limit 200, page cap) — never a bare `xList()` on a paginated endpoint. Check the server default before assuming a list is complete.
  - Detail screens resolve their row by id (`useRepairsGet`) with the shared list only as a faster first source; show the branded loader while the GET / initial shop load is in flight and "not found" only after the GET actually errored.
  - A snapshot kept to survive filtered-list removal must be keyed by the on-screen id, or the previous repair leaks onto the next route.
  - Mutations that diff against "current" (e.g. partsCharge omission) must accept a caller baseline, upsert into the list, and prime the per-id query cache; the row may not be in the list yet.
  - Offset pagination on the server must order by `(createdAt, id)` — equal timestamps otherwise shift page boundaries.
