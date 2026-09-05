---
name: OTP-only account access
description: Product policy for primary sign-in and retired verification data.
---

Mobile OTP is the sole primary account sign-in method across mobile and web. Saved email addresses remain read-only recovery and backup identities; they must not become a competing primary sign-in path.

**Why:** The account model must retain existing users and historic business data while eliminating SIM-originated SMS verification and device-key authentication complexity.

**How to apply:** Send request and resend OTPs to every valid normalized Indian mobile number. Successful verification reuses an existing active account or atomically creates a standalone `customer` account with no shop/business/customer linkage; inactive existing accounts remain denied and must never be replaced or reactivated. Standalone customers receive only chat/profile access. Registration and customer-invite activation may provision or link business accounts, but must return no token and route people to mobile OTP before access. Keep the established OTP provider, expiry, rate limiting, and one-time verification controls. Do not reintroduce SIM verification, SMS bridge callbacks, device-key registration, native keystore login, or SMS-send permissions. Keep historical database tables and applied migrations intact unless a separately approved, non-destructive data-retention plan replaces them.

Outbound OTP endpoints must await provider acceptance before reporting success. If SMS or email delivery fails, invalidate the newly-created local code so an undelivered OTP cannot remain verifiable; log the provider reason server-side but return only a safe delivery error. Registration email must use a sender on a verified Resend domain, never the testing-domain fallback for arbitrary recipients.

Android emulators cannot receive external carrier SMS because they have no real SIM. For simulator testing, send the OTP to a real physical number and enter the received code in the emulator; do not add a production OTP bypass. Hanu OTP is the user-confirmed production SMS provider; do not substitute another provider without explicit approval.

Hanu's live SMS endpoint requires both an international-format Indian number (`91` plus ten digits) and `templatesid`, even though its public SMS reference currently omits the template parameter.

**Why:** Sending only the local number produced false acceptance without handset delivery; removing `templatesid` to match the public docs produced an explicit missing-parameter rejection.

**How to apply:** Preserve both fields in all Hanu request/refactor work, and trust the live provider error contract over the incomplete public parameter table.