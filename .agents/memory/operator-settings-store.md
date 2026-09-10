---
name: Operator settings store
description: Where platform-level, admin-editable configuration lives and what must never go in it.
---

Platform-wide operator configuration that a super_admin can change without a deploy belongs in the global `app_settings` key/value table, exposed through admin-only endpoints and the Update Admin console. Never put secrets, credentials, or tokens there — those stay in workspace secrets.

**Why:** The project had no generic settings surface, so every configurable value was becoming either an env var (needs a restart and an operator with workspace access) or a bespoke table. One key/value table plus a narrow, contract-first endpoint per setting keeps that from multiplying.

**How to apply:** For a new operator-editable value, add a key constant next to the table, a super_admin-gated GET/PUT pair in the OpenAPI spec, and a card on the console Settings page. Setting rows live per environment — a value configured in development is NOT present in the production database after publishing; it must be set again from the live admin console.

Related rule for outbound alerts: emails triggered by public/user actions are best-effort side effects dispatched after the row commits. The persisted record and its admin queue stay authoritative, and UI copy must not promise guaranteed delivery.
