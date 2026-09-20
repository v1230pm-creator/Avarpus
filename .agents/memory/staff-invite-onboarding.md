---
name: Staff invite onboarding
description: Why invited personal accounts must never be "approved" by the owner, and why the business-email recovery prompt is owner-only.
---

Rule: an invited personal account (shop_memberships row with a staffId + hashed claim code) is activated only by the staff member's own `/shop/claim`. The owner's Approve action must refuse it (409), and `/shop/me` must report `backupDetected` only when the account holds an **owner** membership. Staff with an active membership but no selected workspace get direct "Open <shop>" buttons (`/shop/switch`), never the recovery-code screen.

**Why:** Approving flipped the membership active without setting `users.shopId`. The next `/shop/me` then treated the account as an owner with a lost workspace and asked for a 6-digit "recovery code" that is emailed to the shop's verified business mailbox — which staff cannot read. Users reported it as "the app asks the staff for a dealer recovery code".

**How to apply:** Any new path that activates a membership must also select the workspace (or leave the account with a way in that needs no mailbox). Claim and cancel-invite are compare-and-set on membership status/hash so a race cannot leave a "cancelled" invite usable. Dealer-portal logins (`dealer_owner`/`dealer_staff`) cannot be invited — the app offers them no claim flow.
