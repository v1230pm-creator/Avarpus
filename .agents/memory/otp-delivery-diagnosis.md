---
name: OTP "not arriving" diagnosis
description: How to tell a provider-delivery problem from an API fault when users report login OTPs not arriving, and Hanu live-endpoint quirks that differ from its public docs.
---

# Diagnosing "OTP nahi aa raha"

Rule: an accepted send is not a delivered SMS. Hanu is a non-DLT, prepaid
OTP route; "OTP Sent Successfully" only means the provider queued it.
Judge delivery by pairing each `Hanu OTP request accepted` line with a
later `/api/auth/otp/verify -> 200` in the deployment logs. Several
accepted sends with no verify behind them = carrier/provider-side loss,
not an API fault.

**Why:** on 2026-09-21/22 three of four production sends were accepted but
never verified while the API showed zero 4xx/5xx, no throttles and an
empty lockout table; the fourth was delivered and verified within 15 s.

**How to apply:**
- The `otp_codes` table is purged on consume/expiry, so it cannot be used
  for history; only deployment logs show the timeline. Logs do not carry
  the mobile number, so ask the user for number + time if correlation is
  needed.
- Check the dev database too: an empty dev `otp_codes` proves the user was
  on the live app, not Expo Go/preview.
- Hanu live endpoint quirks: it wants the 10-digit local number (its
  public docs show 91-prefixed 12 digits, but the live API's own
  "Invalid mobile number. Only 10-digit Indian numbers..." refusal is the
  contract) and requires `templatesid`; `HANU_OTP_TEMPLATE_ID` is unset
  everywhere, so `default` is sent. Wallet balance and delivery reports
  exist only in the Hanu dashboard — there is no balance/DLR API.
- Codes expire in 10 minutes; a late-delivered SMS surfaces as
  "Incorrect or expired code", not as "no OTP".
- Same API key also serves `voice-otp.php` and `whatsapp-otp.php` — the
  cheapest fallback if SMS delivery stays flaky.
