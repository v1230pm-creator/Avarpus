---
name: Payments ledger & money rules
description: How customer money moves through the system — append-only ledger, advance cache, cost gating, OTP-bound confirmations
---
- All customer payments are append-only `repair_payments` rows; `repairs.advance` is only a cached SUM recomputed in the same tx (shared recordPayment helper in api-server lib/repairPayments.ts). NO code path may write advance directly — server returns 400 ADVANCE_VIA_PAYMENTS; backdated-approval execution also routes advance through the ledger.
**Why:** review found approval execution bypassing the ledger, reintroducing untracked money.
**How to apply:** any new endpoint that touches money must go through recordPayment; grep for `advance` writes before merging.
- Technician assignment ONLY via POST /repairs/:id/assign (dealer/super_admin, same-shop active technician) — create/PATCH ignore technician fields (client bypass found in review).
- Delivery OTP: server binds state — PATCH delivered checks a VERIFIED unconsumed delivery_confirmation OTP (30-min window, consumed in tx); client otpVerified flags are never trusted.
- Cost gating: staff (non dealer/super_admin) get purchasePrice/unitCost/partsCost zeroed + canSeeCosts=false across inventory, repair-parts, return-parts, returns; never log unitCost into repair_events details.
- Estimate approvals: approve applies delta to repairCharge so total = approved amount; status customer_approval ↔ diagnosing.
- Testing gate: transition to ready/delivered from repair phase 400s TESTING_REQUIRED until testingConfirmedAt set.
- Offline intake: clientRequestId idempotency — (shopId, clientRequestId) partial unique index; POST /repairs returns existing row on repeat, so client retries are safe.
- Customer Khata is append-only and uses one authoritative receivable policy: only delivered repair bills/payments + paid refunds + manual Given − manual Received. Received, in-progress, ready, cancelled, and cannot-repair jobs stay out even if they have an advance.
**Why:** Khata is a posted account ledger, not a live repair estimate. A repair enters it only when handover records payment or explicitly confirms the remaining amount as due.
**How to apply:** keep customer cache, Khata detail, and mobile overview on this delivered-only policy; scope idempotency by shop + customer + retry ID and refetch customer aggregates after writes.
