---
name: Testing checklist pass lock
description: Repair testingChecklist Pass/Fail semantics and the immutable-pass rule
---

Repair `testingChecklist` is `Record<string, boolean>`: true = Pass, false = Fail, absent = not tested.

Rule: an item saved as Pass is immutable — it can never become Fail or be removed, by UI or API.

**Why:** business requirement — once a test passes, the record is evidence; reviewers flagged concurrent-write bypass and omission-erasure as defects.

**How to apply:** the testing endpoint must validate inside a transaction with a `FOR UPDATE` re-read; final checklist = incoming entries + previously-passed items the client omitted (so Fail→unset works by omission, Pass survives omission); Pass→Fail returns 409 `TESTING_ITEM_LOCKED`. Any new writer of testingChecklist must repeat this rule. Mobile shows locked items disabled with a lock icon in both the Service Edit modal and the Final Testing modal (shared renderTestingRows).
