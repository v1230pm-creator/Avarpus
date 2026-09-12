---
name: OTP number validation
description: Why mobile-number normalisation must live in one place and how provider refusals are classified.
---

# OTP destination numbers

The SMS provider refuses numbers it cannot deliver to, and it says so in prose
("Invalid mobile number. Only 10-digit Indian numbers starting with 6,7,8,9 are
supported") rather than with a machine-readable code. That prose arrives either
inside a 200 response body **or** as the body of an HTTP error, so both paths
have to be classified before falling back to a generic provider fault.

Rule: a refusal the user can fix by retyping the number must reach the client as
a 400 with plain guidance. A generic 502 "try again" makes an unfixable loop —
the user retypes the same bad number forever.

**Why:** a released Android build showed only "Could not send OTP, please try
again" for numbers the provider had explicitly rejected. Nothing in the app or
the API surfaced the real reason.

**How to apply:** when adding a provider or a new send path, classify the
provider's refusal text on every non-success branch, and keep the local
normalisation strict enough that obviously undeliverable numbers never reach the
provider at all.

## Never duplicate the normaliser inside a test mock

The route tests originally hand-copied the normalisation logic into their
`vi.mock` factory. The copy drifted from the real implementation, so the tests
kept passing while production rejected real numbers. Mock only delivery and
configuration; pull the real normaliser through `importOriginal`.
