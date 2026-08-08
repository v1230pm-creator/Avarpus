---
name: Backdated-entry approval workflow
description: How staff backdated saves are blocked and routed through dealer approval; invariants reviewers enforce.
---

Staff (non dealer/super_admin) cannot save repairs/purchases/finance dated before today. Server returns 403 `{ code: "APPROVAL_REQUIRED" }` from the business routes (`backdateBlocked`); the record is instead filed as an `approval_requests` row and only saved server-side when the dealer approves (`/approvals/:id/approve` executes the insert/patch inside the same transaction).

**Invariants reviewers require:**
- Decisions must atomically claim the row (`UPDATE ... WHERE status='pending' RETURNING`) inside the approve transaction — plain read-then-write is a race that can double-save or save after reject.
- Nothing may persist before approval: mobile must not pre-create customers (or upload photos) for a pending request; customer is resolved/created during approved execution.
- Approved `update` requests must apply the full reviewed payload (allowlisted fields), not just the date.
- Requests are never deleted — they are the permanent audit trail.

**How to apply:** any new dated record type must add the `backdateBlocked` check on its create+update routes AND a branch in `executeApproved`.
