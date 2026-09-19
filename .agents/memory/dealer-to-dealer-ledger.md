---
name: Dealer-to-dealer ledger
description: Rules for the linked shop-to-shop repair/khata flow (send → accept → repair → bill → pay) and why the ledger is shaped the way it is.
---

**Rule:** The repair row held by the repairing shop IS the shared transaction. There is no separate D2D table, no dealer_relationships table, and no second copy of payments. Both shops read the same rows; balances are derived, never stored.

**Why:** The spec forbade a parallel accounting system and duplicate models; existing repair_payments / refunds / repair_events already hold every fact both sides need.

**How to apply:**
- Bill posts to the D2D ledger at status `ready|delivered` (customer khata stays delivered-only). Parties can appear in Khata before any bill posts.
- Ledgers are per (shop, direction). The same counterpart can be my supplier (payable) AND my dealer (receivable); those books are never netted.
- Ledger entry ids are `bill:<repairId>`, `payment:<paymentId>` (void reuses the id with kind `void`, zero-value, visible), `refund:<id>`; entries oldest-first.
- Direction labels (You Owe / They Owe You / You Paid / You Received) must be derived from the SIGN of the balance plus the server-reported side, never from side alone (pre-bill payments leave the payer in credit) and never from an editable route param.
- Money on the transaction detail is a separate permission from seeing the repair: without the `payments` feature the server omits financials/payments/refunds and payment events; clients must treat those fields as optional.
- A ledger between two shops only exists once at least one real transaction links them in that direction; return 404 before resolving the other shop's owner identity, or any shop can look up any owner's mobile.
- Never transfer the sender's end-customer name/mobile into the receiving shop's repair row; the "customer" of a D2D repair is always the source shop + its owner contact. The sender projection also omits `notes` (receiver may overwrite with internal notes).
- D2D chat is an ordinary direct room with the counterpart's owner, matched by exact `ownerUserId` (fail closed), optionally prefilled with a `draft` param.
