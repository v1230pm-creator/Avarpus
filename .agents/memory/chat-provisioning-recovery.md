---
name: Chat provisioning recovery
description: Constraint for safely recovering an interrupted direct-room provisioning attempt.
---

Do not add time-based takeover or deletion of a memberless direct-chat reservation while its original worker could still be provisioning Matrix. Recovery must first have a provider-side idempotency/reconciliation mechanism and a durable fencing/attempt identity.

**Why:** The local peer-pair uniqueness constraint prevents duplicate database rooms, but it cannot cancel a prior Matrix `createRoom` call. An unfenced retry can therefore create a second remote room even though only one local row survives.

**How to apply:** For normal provider errors, the owner that made the request may clean up its own still-memberless reservation. If product requirements add crash recovery, first use a deterministic Matrix-side identifier or equivalent lookup and record an attempt/fencing token before allowing another worker to provision.