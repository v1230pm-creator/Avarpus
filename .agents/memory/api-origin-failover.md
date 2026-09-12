---
name: API origin failover
description: Constraints any client-side fallback API origin must satisfy before it can ship.
---

# Falling back to a second API origin

A released app dies completely when its single API hostname stops resolving, so
a client-side fallback origin is tempting. It is only safe under these rules:

- **Never replay a non-idempotent request.** A transport-level rejection does
  not prove the server failed to commit. Retrying a POST/PATCH/DELETE against a
  fallback can double-charge a payment or duplicate a message. Restrict
  automatic failover to safe methods, or make the replay carry the same
  idempotency key the primary request used.
- **Validate the fallback origin as strictly as the primary one.** The client
  forwards bearer tokens to whatever origin it is handed, so a fallback must be
  HTTPS, origin-only (no path, no credentials, no query), and configured at
  build time — not discovered at runtime.
- **A health probe is not proof of identity.** Reaching *something* at the
  fallback host does not mean it is the same API; keep the fallback list to
  hostnames the project itself owns.

**Why:** a fallback implementation that auto-replayed every method and accepted
unvalidated origins was flagged in review as a token-leak and double-write risk.

**How to apply:** whenever base-URL failover, retry-on-network-error, or an
"alternate domain" feature comes up, check these three points before shipping,
and cover the transport behaviour with tests that assert mutations are *not*
replayed.
