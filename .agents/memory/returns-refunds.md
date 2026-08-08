---
name: Return/Rework/Refund workflow
description: Invariants for the repair return cases and refund transactions; what reviewers require.
---

Delivered repairs can gain return cases (`repair_returns`, ids RET-<ticket>-NN) with a strict server-side state machine: return_received → inspection → rework_approved (dealer-only) → in_repair → ready → delivered; closed/reopen dealer-only. Refunds are separate rows/finance expenses — original repair money fields are never edited.

**Invariants reviewers require:**
- Enforce the transition graph, not just "dealer-only target names" — staff must not skip rework_approved.
- Closed cases are frozen for everyone (edits, parts, refunds) until dealer reopens.
- Refund cap is repair-level and cumulative: sum of non-rejected refunds across all return cases ≤ original charge; re-check on approve (amount can be adjusted); serialize via SELECT ... FOR UPDATE on the repair row.
- Human-readable sequence ids (count-then-insert) need a row lock + unique index backstop.
- Status decisions (approve/reject/mark-paid) use conditional claims (`WHERE status = expected`).
- Parts deduct stock atomically (`SET qty = qty - n WHERE qty >= n`); refunds never restock automatically.

**How to apply:** any new endpoint touching return cases must re-read the case with FOR UPDATE inside its transaction and respect closed-state + the graph.
