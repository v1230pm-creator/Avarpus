---
name: OTP-only account access
description: Product policy for primary sign-in and retired verification data.
---

Mobile OTP is the sole primary account sign-in method across mobile and web. Saved email addresses remain read-only recovery and backup identities; they must not become a competing primary sign-in path.

**Why:** The account model must retain existing users and historic business data while eliminating SIM-originated SMS verification and device-key authentication complexity.

**How to apply:** Send request and resend OTPs to every valid normalized Indian mobile number. Successful verification reuses an existing active account or atomically creates a standalone `customer` account with no shop/business/customer linkage; inactive existing accounts remain denied and must never be replaced or reactivated. Standalone customers receive only chat/profile access. Registration and customer-invite activation may provision or link business accounts, but must return no token and route people to mobile OTP before access. Keep the established OTP provider, expiry, rate limiting, and one-time verification controls. Do not reintroduce SIM verification, SMS bridge callbacks, device-key registration, native keystore login, or SMS-send permissions. Keep historical database tables and applied migrations intact unless a separately approved, non-destructive data-retention plan replaces them.