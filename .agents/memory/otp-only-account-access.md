---
name: OTP-only account access
description: Product policy for primary sign-in and retired verification data.
---

Mobile OTP is the sole primary account sign-in method across mobile and web. Saved email addresses remain read-only recovery and backup identities; they must not become a competing primary sign-in path.

**Why:** The account model must retain existing users and historic business data while eliminating SIM-originated SMS verification and device-key authentication complexity.

**How to apply:** Send request and resend OTPs to every valid normalized Indian mobile number. Successful verification reuses an existing active account or atomically creates a standalone `customer` account with no shop/business/customer linkage; inactive existing accounts remain denied and must never be replaced or reactivated. Standalone customers receive only chat/profile access. Registration and customer-invite activation may provision or link business accounts, but must return no token and route people to mobile OTP before access. Keep the established OTP provider, expiry, rate limiting, and one-time verification controls. Do not reintroduce SIM verification, SMS bridge callbacks, device-key registration, native keystore login, or SMS-send permissions. Keep historical database tables and applied migrations intact unless a separately approved, non-destructive data-retention plan replaces them.

OTP proves control of the number, so every active dealer/customer record with that normalized mobile belongs to the caller; multi-match must never fail closed (the old `AMBIGUOUS_MOBILE_MATCH` 409 was removed at user request). Resolution for a standalone account: a dealer party wins (newest active dealer row, tie-broken by id → `dealer_owner`); otherwise customer rows, newest shop first, attaching only to a shop where the login can own ≥1 row (rows already claimed by another login are skipped, never a conflict). Every OTP login of an attached portal account re-links unlinked matching customer rows in its own shop (`customer_users` allows many rows per user; `customer_id` stays unique). Portal ownership = dealerId match OR any owned customer row; khata merges owned rows. `GET /dealers/me` also returns the shop as `supplier` (owner name + mobile) so the dealer sees who repairs for them.

**Corollary:** because linking keys off `users.mobile`, a session must never change its own mobile without an OTP (`PATCH /auth/me` rejects it with `MOBILE_CHANGE_REQUIRES_OTP`); otherwise an account could sit on a victim's number and inherit their rows at the victim's next OTP.

OTP resolution and every production writer that creates or changes those matching mobiles must share the same transaction-scoped advisory lock; updates lock old/new values in sorted order.

**Why:** OTP proves control of one number, but concurrent or duplicate business records must never let a session attach to the wrong dealer/customer or expose another party's repairs and balances.

**How to apply:** Treat the customer-user/dealer link as authorization, not the phone number itself. Recheck link claims inside the locked transaction, return a conflict without issuing a session when the claim is lost, and keep portal repair responses read-only and narrowly projected.

Outbound OTP endpoints must await provider acceptance before reporting success. If SMS or email delivery fails, invalidate the newly-created local code so an undelivered OTP cannot remain verifiable; log the provider reason server-side but return only a safe delivery error. Registration email must use a sender on a verified Resend domain, never the testing-domain fallback for arbitrary recipients.

Android emulators cannot receive external carrier SMS because they have no real SIM. For simulator testing, send the OTP to a real physical number and enter the received code in the emulator; do not add a production OTP bypass. Hanu OTP is the user-confirmed production SMS provider; do not substitute another provider without explicit approval.

Hanu's live SMS endpoint requires both a local 10-digit Indian number and `templatesid`, despite conflicting public SMS documentation.

**Why:** Removing `templatesid` produced an explicit missing-parameter rejection, while adding the documented `91` prefix produced an explicit “only 10-digit Indian numbers” rejection. The user confirmed real-device SMS delivery with the `default` template.

**How to apply:** Send the normalized ten digits unchanged and preserve `templatesid`; trust the live provider error contract over the inconsistent public parameter table.