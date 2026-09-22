---
name: Chat receipt retention
description: Rules and rationale for pruning chat_message_receipts without breaking the relay purge or the sender's ticks.
---

**Rule:** receipts are pruned only when the message's relay lifecycle is settled (`object_path IS NULL` or `media_state <> 'available'`) AND (message is a delete-for-everyone tombstone OR the *receipt's* `updated_at` is past the retention window). Never prune a receipt on an `available` relay copy, even if it is ancient.

**Why:** the relay purge decides "every recipient stored it" from `stored` receipts on `available` media; deleting those would make the purge wait forever (or, with a hard cap, expire media a device already stored). Media state only ever moves away from `available`, so a settled message can never need its receipts again. The receipt's own age (not the message's) protects a late read-backfill receipt until the sender's devices have had the window to sync it. A relay purge that is switched off simply means media receipts never age out — correct, since the purge may later be enabled.

**How to apply:** run the prune strictly after the purge in the same daily chain (never concurrently); read fallbacks (`deliveryForMessages` legacy synced-app signal + `chat_read_state`) must keep working with zero receipts, and a repeat ack after a prune must be accepted as a fresh first-seen row rather than refused. Room-scoped runs must not overwrite the whole-table last-run record. Keep the window a code constant; do not expose it as an operator setting without also revisiting the sync stream's oldest-device assumptions.
