---
name: Per-role feature toggles (Staff Permissions)
description: Owner-editable per-shop feature switches for staff/portal roles — where they live and the rules for extending them
---

Shop owner (dealer/super_admin) toggles features per role from mobile More → Staff Permissions. Stored in `role_feature_settings` (shopId+role PK, jsonb overrides); missing rows/keys fall back to server defaults that mirror the old hard-coded role behavior.

**Rules:**
- Server is the source of truth: defaults, keys, and `requireFeature`/`userHasFeature` live in api-server `lib/roleFeatures.ts`. Owner roles always bypass. Portal roles have a single `portal_repairs` key enforced inside requireAuth (portal is read-only by design — do not add portal write toggles).
- Any NEW mutation endpoint for a toggleable area (customers, repairs create/update, inventory, purchases, finance, payments, reports, approvals, dashboard) must add `requireFeature(...)` — reviewers fail the change otherwise.
- Do NOT gate the shared GET collection endpoints (`GET /customers|/repairs|/inventory|/purchases|/finance`): mobile DataContext loads them blocking for every role; a 403 there breaks app boot.
- Client mapping lives in AuthContext `PERM_TO_FEATURE`; canAccess falls back to old ROLE_PERMISSIONS until toggles load. Keep client keys in lockstep with server keys.
- Matrix cache is per-process, 15s TTL — accepted propagation bound; staff apps refresh toggles every 60s.

**Why:** built so the owner can self-serve permissions without developer help; the review bar is server-side enforcement for every advertised toggle, not just UI hiding.
