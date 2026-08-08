---
name: Registration & staff model
description: Who can create which account types in VMC BMS and how staff approval works
---
Rule: Public registration creates either an ACTIVE `dealer` account (shop auto-provisioned in the same transaction, auto-login session returned) or a PENDING staff account (`reception`, `technician`, `store_manager`, `accountant`) that joins an existing shop identified by the dealer's registered mobile. Staff land with `isActive: false`, get NO session (register/verify returns `{pending, message, user}` instead of a token), and cannot log in until a dealer/super_admin approves them via `PATCH /staff/:id/activate`; rejection is `DELETE /staff/:id` (pending accounts only). Any other requested role → 403. Dealer-created staff via `POST /staff` remain active immediately. `super_admin` is never creatable via any API — seeding is gated behind `SEED_DEMO_USERS=true` and disabled by default.

**Why:** User mandate (Aug 2026): admin/super_admin accounts must never be publicly creatable; the earlier hidden triple-tap admin registration + access-code path was removed. Staff self-registration was later added (Aug 2026) but is safe because accounts stay inactive until shop-owner approval and role assignment is validated server-side.

**How to apply:** Any new signup surface or auth endpoint must keep role assignment server-side, keep self-registered staff inactive until approval, and scope staff to the resolved shop. Approve/reject endpoints must enforce shop scoping (dealer only manages own shop) and never target self or super_admin.
