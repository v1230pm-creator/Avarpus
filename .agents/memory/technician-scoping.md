---
name: Technician access scoping
description: Server-side rules restricting technicians to assigned repairs and work fields
---
Technicians are scoped server-side, not just in UI:
- GET /repairs force-filters `technicianId = me` for role technician (client filters ignored).
- PATCH /repairs/:id, POST /repairs/:id/testing and POST /repairs/:id/parts 403 (NOT_ASSIGNED) if the repair is not assigned to the calling technician.
- Technician PATCH is field-allowlisted (status, diagnosis, workPerformed, notes, priority); anything else 403s FIELD_NOT_ALLOWED.

**Why:** reviewers flagged presentation-only role checks as broken access control (cross-technician PII/device-password exposure, financial field manipulation).
**How to apply:** any new repair sub-resource endpoint must repeat the assignment check for technicians; don't rely on the mobile "Assigned to me" toggle.
