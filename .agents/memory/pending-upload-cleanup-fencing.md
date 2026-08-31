---
name: Pending upload cleanup fencing
description: Safety rules for reclaiming abandoned private uploads without deleting media during attachment.
---

Abandoned-upload cleanup must coordinate with attachment operations through exclusive, claimant-token-fenced leases. Refresh the lease immediately before irreversible external work and again before durable attachment; bound external work below the lease duration. Release and completion must match the claimant token so a stale request cannot clear a replacement lease.

**Why:** A plain TTL or same-owner lease is not a processing fence. Concurrent retries can clear each other's protection, and an unbounded provider call can outlive the lease while cleanup deletes media that is still being attached.

**How to apply:** Use advisory locking when acquiring, refreshing, and deleting around a path; reject overlapping active claims; verify the token on release/complete; re-check durable references under the cleanup lock; enumerate only the exact eligible namespaces rather than the full private upload tree.