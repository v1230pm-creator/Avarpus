---
name: Testing checklist pass lock
description: Repair testingChecklist Pass/Fail semantics and the immutable-pass rule
---

Repair `testingChecklist` is `Record<string, boolean>`: true = Pass, false = Fail, absent = not tested.

Rule: an item saved as Pass is immutable — it can never become Fail or be removed, by UI or API.

**Why:** business requirement — once a test passes, the record is evidence; reviewers flagged concurrent-write bypass and omission-erasure as defects.

Stage locks (added later): service fields are editable only in their workflow stage — problem only at `received`, diagnosis/workPerformed only in diagnosing/waiting_parts/repairing, checklist writes only in testing/customer_approval; violations return 409 `FIELD_LOCKED_STAGE` (only actual value changes are rejected, so echoed full-object PATCHes pass). Status may never roll back to `received` (409 `INVALID_STATUS_TRANSITION`); testing-fail may return a job to `repairing` (client offers Return to Repair / Customer Return→cannot_repair). Client saves stage fields via partial `repairsUpdate` payloads, not the full-object DataContext updateRepair.

**How to apply:** the testing endpoint must validate inside a transaction with a `FOR UPDATE` re-read; final checklist = incoming entries + previously-passed items the client omitted (so Fail→unset works by omission, Pass survives omission); Pass→Fail returns 409 `TESTING_ITEM_LOCKED`. Any new writer of testingChecklist must repeat this rule. Mobile shows locked items disabled with a lock icon in both the Service Edit modal and the Final Testing modal (shared renderTestingRows).
