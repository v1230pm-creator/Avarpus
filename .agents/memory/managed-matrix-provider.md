---
name: Managed Matrix provider
description: Approved managed service and provisioning boundary for VMC encrypted communications.
---

VMC’s approved managed Matrix service is Element Server Suite Pro (fully managed cloud). Provision a dedicated private tenant with a real custom Matrix homeserver domain before implementing provider-dependent messaging.

**Why:** The app requires audited end-to-end encryption, private account provisioning, and no placeholder endpoints or custom cryptography.

**How to apply:** Do not add a homeserver URL, Matrix administrator credential, user credential, or encryption fallback until Element has provisioned the tenant and the user supplies the actual values through Replit Secrets. Keep public registration, guest access, public room discovery, and unapproved federation disabled.