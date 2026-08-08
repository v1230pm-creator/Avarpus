---
name: 4-tab repair workflow invariants
description: Rules for the Received/Repair/Delivered/After-Sales repair lifecycle and repair parts ledger.
---

All four tabs are views over the same repairs table (same VMC-xxx ticket); After-Sales = return cases. Reviewers required:

- Delivered is terminal for staff: staff cannot move a delivered repair back to any other status (un-deliver → edit money → re-deliver bypass). Dealer/super_admin only.
- Financial fields (repairCharge/partsCharge/advance) on delivered repairs are staff-locked (403 "Dealer/Owner approval required.").
- Once a repair has rows in the repair_parts ledger, partsCharge is server-derived only — direct PATCH writes are rejected (400), and repair PATCH locks the repair row FOR UPDATE to serialize with part postings. Mobile DataContext only sends partsCharge when it changed.
- receivedBy/deliveredBy are stamped server-side from the authenticated user (approval-executed backdated creates use the original requester), never client-supplied.

**How to apply:** any new repair mutation path (or approval execution branch) must respect the delivered lock, avoid direct partsCharge writes, and stamp accountability fields server-side.
