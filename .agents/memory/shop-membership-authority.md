---
name: Shop membership authority
description: Defines the source of truth for optional multi-Shop access and legacy compatibility fields.
---

Treat each active Shop membership's role and status as authoritative for business authorization, invitations, staff management, and workspace switching. The user's global role and Shop ID only mirror the currently active workspace for compatibility with older business routes.

**Why:** Trusting the global compatibility fields after a membership was revoked allowed stale owner authority, and updating only the global role allowed an old membership role to return after switching workspaces.

**How to apply:** Authorize against an active membership for the requested Shop. Update membership role/status first; mirror global fields only when that Shop is active. Revocation must persist as a non-active row rather than deleting the membership.