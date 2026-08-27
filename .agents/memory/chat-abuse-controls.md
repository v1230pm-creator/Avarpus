---
name: Chat abuse controls
description: Durable safety and idempotency rules for global direct-chat blocks and reports.
---

Treat a directional block as a pair-wide restriction for discovery, room creation, messages, uploads, and calls. Only the user who created the block may remove it; existing history stays readable.

**Why:** A one-sided enforcement check lets the blocked user bypass the control, while deleting history would remove evidence and surprise users.

**How to apply:** Resolve both participants server-side and check either block direction at every new-contact or mutation boundary.

Abuse reports must use a server-enforced per-reporter request identity, a bounded submission rate, and a client request ID that survives ambiguous failures until confirmed success or deliberate draft changes.

**Why:** A database uniqueness constraint is ineffective if clients generate a new ID for every retry; lost responses then duplicate moderation records.

**How to apply:** Keep a pending report ID keyed to the report draft, replay it after errors, clear it only after confirmed success or when the draft is discarded, and serialize rate checks in the database.