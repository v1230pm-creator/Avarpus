---
name: OTP throttle refunds during provider outages
description: Why OTP send throttles refund only per-mobile slots for provably undispatched sends, and how to diagnose a dead SMS provider from a 429.
---

# OTP throttles and SMS provider outages

Rule: an OTP send that provably never reached the provider (DNS/connect error
code, no API key) refunds only the **per-mobile** throttle slot. The per-IP
slot is never refunded. Timeouts, resets, HTTP errors, unrecognised bodies and
"invalid number" refusals count against both. When one dimension denies, the
other dimension's reservation is released.

**Why:** the SMS provider's domain (hanuotp.in) dropped out of DNS on
2026-09-14. Every send failed with 502, but after 3 tries users saw "Too many
code requests" for 15 minutes, which hid the real fault and blocked retries
after recovery. Refunding everything on any failure was rejected in review:
ambiguous failures may have delivered an SMS, refunding per-IP removes the only
bound on unauthenticated work, and denied two-dimensional checks used to poison
a victim's mobile bucket from an exhausted IP.

**How to apply:** when adding a provider or send path, classify pre-dispatch
failures explicitly (walk `error.cause` / `AggregateError.errors` for codes),
never infer "not sent" from "no abort". Diagnose a sudden wave of 429s on OTP
by checking deployment logs for provider `fetch failed` and resolving the
provider host from an outside resolver; NXDOMAIN at the TLD means the
provider's domain is gone, not a network blip. A provider-outage circuit
breaker is still an open improvement.
