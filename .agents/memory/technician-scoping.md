---
name: Technician access scoping
description: Technicians now have the same full shop-wide view as reception; assigned-only gating was removed.
---
Technicians see the FULL shop repairs list, customers, and dealers — the old assigned-repairs-only filter and the work-field allowlist were removed at the owner's request (Aug 2026).

**Why:** owner wanted technicians to work like reception (full dashboard/repairs/customers view) with the per-role Staff Permissions toggles as the only gate.

**How to apply:** do NOT reintroduce `technicianId=me` forcing, NOT_ASSIGNED checks, or TECH_FIELD allowlists on repair endpoints. Access control for staff lives in role feature toggles (`requireFeature`) — every repair-mutating subroute (PATCH, testing, parts) must carry `requireFeature("repairs_update")`. The mobile "Assigned to me only" checkbox still exists but defaults off.
