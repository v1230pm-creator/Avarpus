---
name: Testing checklist pass lock
description: Repair testingChecklist Pass/Fail semantics and the immutable-pass rule
---

Repair `testingChecklist` is `Record<string, boolean>`: true = Pass, false = Fail, absent = not tested.

Rule: an item saved as Pass is immutable — it can never become Fail or be removed, by UI or API.

**Why:** business requirement — once a test passes, the record is evidence; reviewers flagged concurrent-write bypass and omission-erasure as defects.

Stage locks: service fields are frozen once the job moves past their stage, and the server enforces a forward-only status graph (the only rewind is testing→repairing, now unconditional — the checklist is a legacy web-only field) — otherwise the field locks are bypassable by rewinding the status. Reject only *actual value changes* to locked fields, since clients echo full repair objects on every PATCH; new save paths should send partial payloads, not the full-object update helper.

**How to apply:** the testing endpoint must validate inside a transaction with a `FOR UPDATE` re-read; final checklist = incoming entries + previously-passed items the client omitted (so Fail→unset works by omission, Pass survives omission); Pass→Fail returns 409 `TESTING_ITEM_LOCKED`. Any new writer of testingChecklist must repeat this rule. The mobile app no longer writes the checklist at all (work is described via notes); only the web app still does.
