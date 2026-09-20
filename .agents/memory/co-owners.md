---
name: Co-owners (multiple owners per Shop)
description: How a Shop gets a second owner, what "owner" means across the two role systems, and the single-owner assumptions that remain.
---

Rule: a Shop may have any number of `shop_memberships` rows with role `owner`. A co-owner is added by an existing owner through the normal invitation (`role: "owner"`) and joins through the same Staff ID + claim code handshake as staff. Active co-owners are listed in the team but are unmanageable by each other (no edit, permissions, approve, or removal); only a still-pending owner invite can be cancelled.

**Why:** shops with two proprietors (partners, brothers) need equal access without sharing one login. Authority already derives from the active owner membership, and `users.role` is only a mirror — so an owner membership is mirrored as `dealer`, never as a raw `owner` value (legacy gates and notification fan-out only know `dealer`/`super_admin`).

**How to apply:**
- Resolve "the owners of a Shop" from active owner memberships (`lib/shopOwners.ts`), not from `users.shopId + role` — a co-owner keeps owning the Shop while another workspace is selected.
- Owner-only mirror fields (GSTIN, "Owner" designation) are set when an owner membership is selected and cleared when a staff membership is; documents print `user.gstNumber`.
- `shops.dealer_id` still records the single creating owner and is what the dealer ledger / transfers / directory treat as the counterpart. Accounts that already run their own Shop (`users.role = dealer`) cannot be invited as co-owner.
