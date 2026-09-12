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

## Task-completion gate (stage unlock)
- Status moves must be ADJACENT (same rank or +1); skipping stages is INVALID_STATUS_TRANSITION even with a complete payload. Voiding and dealer restore-from-void are exempt.
- STAGE_INCOMPLETE (409, with `missing[]`) now gates only leaving 'received' (intake fields). Diagnosis/workPerformed/testing checklist no longer gate anything (Sept 2026 decision): staff describe work via append-only notes (POST /repairs/:id/notes → repair_events action note_added, read through /events). Do not reintroduce work-field gates; the mobile app no longer edits diagnosis/workPerformed/testing at all (legacy fields remain readable + PATCHable for web).
- testing→repairing is the only rewind and is unconditional (used to require a failed checklist item).
- POST /repairs ignores client status — always starts at 'received' (no create-as-delivered).
- Tests that deliver a repair only need received→repairing→testing→ready→delivered; intake fields are the only prerequisite.
- **Why:** the owner found the Complaint/Diagnosis/Repairing/Testing card too heavy; technicians should just write what they did.

## Mobile stage and delivery UX
- The repair detail primary action lives at the end of the scroll content and names its destination: Continue as Repairing/Testing/Ready, then Continue to Deliver.
- Intake and delivery do not capture signatures. Delivery does not use OTP verification.
- Continue to Deliver opens the financial decision: an outstanding balance must be explicitly left as Due or recorded as Mark as Paid; an already-paid repair completes directly.

**Why:** staff need one predictable forward action per stage, with payment posting deferred until delivery and no signature/OTP handover friction.

**How to apply:** do not restore fixed payment buttons, intake/delivery signature capture, or delivery OTP in mobile repair screens; preserve estimate-approval OTP as a separate workflow.
