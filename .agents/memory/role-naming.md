---
name: Role naming — super_admin, not admin
description: The app-wide privileged role is 'super_admin'; never introduce an 'admin' role.
---
The privileged role is `super_admin` (displayed as "Admin"). There is no `admin` role.

**Why:** Introducing `role: "admin"` server-side once produced accounts the client couldn't authorize — no permissions, undefined label.

**How to apply:** Any server route, spec enum, or UI offering an elevated role must use `super_admin`; check the client's role type for the current full set.
