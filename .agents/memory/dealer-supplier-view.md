---
name: Dealer supplier view & portal graduation
description: How a person filed as a B2B dealer by other shops sees those repairs from their own business account, and how a portal login becomes a shop owner
---
**Rule:** A business account's "supplier" relationships are resolved at read time from the OTP-verified `users.mobile`, matched in SQL against ACTIVE `dealers` rows of OTHER shops (stored dealer mobiles are unnormalised; compare the compacted value against `m / 0m / 91m / +91m`). The caller's own shop is never a supplier; a supplier shop's `dealer_owner.portal_repairs` switch hides it. Responses use the same read-only portal projection as `/repairs` for portal logins — never the full repair row, never a write.

**Why:** Shop A files dealer X by phone number before X has any account; the number is the only shared identity, and OTP already proved control of it (sessions cannot change their own mobile). Persisting a link would go stale the moment A edits the row.

**How to apply:** Any new "my repairs elsewhere" surface must re-verify the dealer row (mobile match + active + feature on) on every request, and mobile must not open these rows through the own-shop repair detail route — they are not in the caller's shop.

**Portal graduation:** a `dealer_owner`/`dealer_staff` login's `users.shopId` points at the SUPPLIER's shop, not a workspace of its own; `/shop/setup` treats portal roles as having no workspace and, on verify, sets role `dealer`, the new shopId and `dealerId: null`. The contract family `shop-setup` is `inactiveDealerExempt` (like auth self-service) so a supplier deactivating the dealer row cannot veto the person's independent business; the validator whitelists exactly those two families. The mobile inactive-portal screen must likewise let the Shop tab through.
