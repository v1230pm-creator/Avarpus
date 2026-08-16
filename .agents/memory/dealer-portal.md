---
name: Dealer repair management & portal
description: B2B dealers table, dealer-linked repairs, and read-only dealer-portal logins — invariants to preserve
---
- `dealers` = per-shop B2B party records (code DLR-NNN); the `dealer` ROLE is still the shop owner — do not confuse them.
- Portal roles `dealer_owner`/`dealer_staff` (users.dealerId) are fail-closed allowlisted in requireAuth (lib/dealerPortal.ts); anything not listed is 403.
- **IDOR rule:** shop-scoping alone is NOT enough for portal accounts. Every repair subresource (events/photos/payments) must use the portal-aware `repairAccessible()` check (repairs.dealerId === user.dealerId), and the storage route only serves objects attached to the portal dealer's own repairs.
- Repairs snapshot `dealerName` at link time; PATCH of dealerId is privileged-only and re-synced by dealer PATCH.
- Mobile: portal accounts get only Repairs+More tabs, "My Repairs" view, DataContext skips bulk loads (would 403).

**Why:** review round caught a portal IDOR (cross-dealer events/photos/payments by UUID) and a dropped dealerId in the online intake path (DataContext.addRepair mapping is explicit — new fields must be added there too, not just in screen payloads).
