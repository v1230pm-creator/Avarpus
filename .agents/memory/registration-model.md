---
name: Registration & staff model
description: Who can create which account types in VMC BMS
---
Rule: Public registration creates ONLY active `dealer` accounts (role forced server-side; any other requested role → 403). Each dealer gets an auto-provisioned `shops` row (default settings jsonb) inside the same DB transaction as the user insert, then an auto-login session is returned. Staff (`reception`, `technician`, `store_manager`, `accountant`) are created only via `/staff` endpoints guarded by requireAuth + requireRole('dealer','super_admin') and inherit the dealer's shopId. `super_admin` is never creatable via any API — seeding is gated behind `SEED_DEMO_USERS=true` and disabled by default.

**Why:** User mandate (Aug 2026): staff/admin accounts must never be publicly creatable; the earlier hidden triple-tap admin registration + access-code path was removed for this reason — do not reintroduce it.

**How to apply:** Any new signup surface or auth endpoint must keep role assignment server-side; staff creation always flows through the dealer's shop scope.
