---
name: Matrix homeserver DNS
description: "Failed to deliver message to chat provider" in production with "fetch failed" in logs was a missing DNS record for the custom Matrix hostname, not a provider or credential fault.
---

The homeserver URL is a custom subdomain of the marketing domain (zone hosted at the registrar/Hostinger), pointing at the managed ESS deployment. If that record is removed (e.g. while editing the zone for the website or the API subdomain), every chat send/provision fails with the client fallback message while the API deployment stays healthy.

**Why:** Node's fetch collapses DNS/TLS/connect failures into "fetch failed"; the real reason lives on `error.cause` (ENOTFOUND). Logs now print that cause via `describeProviderError`.

**How to apply:** on chat-provider failures, first resolve the Matrix hostname from an outside resolver (dns.google NXDOMAIN = missing record). The fix is re-adding the DNS record with the target from the ESS admin console; nothing in code or secrets needs to change. Same failure class as the `api` subdomain incident (see custom-api-domain-dns.md).
