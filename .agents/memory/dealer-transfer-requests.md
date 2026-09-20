---
name: Dealer-to-dealer transfer requests
description: Offer/accept model for sending an existing repair to another verified shop; what the receiver may see before accept and how reads/mutations are gated.
---

**Rule:** A dealer transfer is an *offer* (`dealer_transfer_requests`), never a direct insert into the receiver's shop. The receiver's repair row is created only inside the accept transaction (claim `pending → accepted` with a conditional update, `FOR UPDATE` on the source row), importing only non-empty saved fields. Accept *is* physical receipt (`sourceDealerReceivedAt` set at accept); the legacy `/receive` route stays idempotent for old rows only.

**Why:** Spec requires "nothing in the receiver's active queue until accept", a "Waiting for <B> to accept" state for the sender (never "Received"), cancel-before-accept, and resend-after-decline — none of which fit a row that already exists in the receiver's shop.

**How to apply:**
- Receiver row `customerName` = `<sender shop> (Dealer)`; the sender's end-customer identity is never copied. `sourceRepairId` on the receiver row is the link the spec asks for; shop isolation makes it unusable cross-shop — do not "fix" it away.
- Mutations (send/accept/decline/cancel) require `repairs_update` server + client; reads (directory, transfers list/get) use the same bar as `GET /repairs` (`repairs` feature), not the mutation toggle — finance-only staff get 403, and the isolated test asserts it.
- A new send is blocked while a request is pending or accepted-and-still-active (`TRANSFER_PENDING` / `TRANSFER_ACTIVE`); delivered/cancelled repairs can't be sent (`REPAIR_CLOSED`).
- Notification payloads: `transferId` without `dealerTransaction:true` opens the request screen (receiver has no repair yet); accepted alerts carry `repairId + dealerTransaction:true` and open the shared transaction.
- Mobile: request-screen decisions need a synchronous ref guard — `mutation.isPending` flips only after a re-render, so two fast taps both fire.
- Ticket numbers on accept use the same `count+1` per shop as intake; a concurrent-allocation race exists there too (systemic, unchanged).
