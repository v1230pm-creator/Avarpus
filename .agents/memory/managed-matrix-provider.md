---
name: Managed Matrix provider
description: Approved ESS Pro service, Application Service boundary, and deferred encryption status.
---

VMC’s approved managed Matrix service is Element Server Suite Pro (fully managed cloud). The app must connect through a registered Matrix Application Service whose exclusive virtual-user namespace matches the app’s configured namespace.

**Why:** Matrix `?user_id=` masquerading is an Application Service capability, not a normal administrator-token capability. Creating rooms as an admin also adds an unintended third provider member. E2EE is deferred and must not be claimed as enabled.

**How to apply:** Require an explicit homeserver URL, server name, and Application Service token supplied through Replit Secrets. Create/send as virtual participants and verify exactly two joined provider members before local persistence. Keep public registration, guest access, public room discovery, unapproved federation, and encryption fallbacks disabled.