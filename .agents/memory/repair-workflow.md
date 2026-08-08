---
name: 4-tab repair workflow invariants
description: Rules for the Received/Repair/Delivered/After-Sales repair lifecycle and repair parts ledger.
---

All four tabs are views over the same repairs table (same VMC-xxx ticket); After-Sales = return cases. Reviewers required:

- Delivered is terminal for staff: staff cannot move a delivered repair back to any other status (un-deliver → edit money → re-deliver bypass). Dealer/super_admin only.
- Financial fields (repairCharge/partsCharge/advance) on delivered repairs are staff-locked (403 "Dealer/Owner approval required.").
- Once a repair has rows in the repair_parts ledger, partsCharge is server-derived only — direct PATCH writes are rejected (400), and repair PATCH locks the repair row FOR UPDATE to serialize with part postings. Mobile DataContext only sends partsCharge when it changed.
- receivedBy/deliveredBy are stamped server-side from the authenticated user (approval-executed backdated creates use the original requester), never client-supplied.

- Delivery date is server-stamped on handover (create or PATCH); staff-supplied/backdated delivery dates are ignored — only dealer may set an explicit date. After-sales "days since delivery" depends on this.
- After-sales cases use the 13 spec statuses (`returned`…`closed`); refund_requested/approved/paid are set ONLY by the refund endpoints (mirrored onto the case), never via PATCH; rework_required/closed are dealer-only; case PATCH writes are CAS-guarded (`WHERE status = <read status>`, 409 on race). Case IDs are `AS-<ticket>-NN` (legacy `RET-` ids remain in old data).

**How to apply:** any new repair mutation path (or approval execution branch) must respect the delivered lock, avoid direct partsCharge writes, and stamp accountability fields server-side.
