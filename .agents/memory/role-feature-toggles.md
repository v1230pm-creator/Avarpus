---
name: Per-role feature toggles (Staff Permissions)
description: Durable security rules for owner-managed workspace permissions
---

Workspace owners can configure feature access by staff or portal role. Missing overrides retain backward-compatible defaults, while owner accounts remain unrestricted.

**Rules:**
- The server is the source of truth; UI hiding never replaces endpoint authorization or workspace/object scoping.
- Gate reads as well as writes. Clients must not request unavailable business collections and must clear data immediately after revocation.
- Business access fails closed while policy is missing or stale. Personal account features remain independently available.
- Bind policy and data to the active identity. Logout, revocation, and account replacement must discard late responses and all prior authenticated caches before another identity is admitted.
- Portal access stays read-only and dealer-scoped. Canonical permissions are derived compatibility views, not a second persisted policy system.

**Why:** owner-managed permissions are security boundaries, not navigation preferences. Revocation, refresh failure, and shared-device account switches must not leave stale access or cross-shop data visible.
