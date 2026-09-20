---
name: Dealer directory search
description: Why "Send to Dealer" search could not find registered dealers, and the rules the directory/lookup endpoints must keep.
---

**Rules**
- A "verified shop owner" is any shop whose `shops.dealerId` user is an active `OWNER_ROLES` account (`dealer` **or** `super_admin`). Filtering on `role = 'dealer'` alone silently hides the platform owner's own shop.
- Typed mobiles are normalised with the OTP normaliser (`+91`, leading `0`, spaces, dashes) and then matched **exactly**; partial digits must never match (owner-mobile enumeration).
- Directory and legacy lookup are gated by `repairs_update` — the same bar as sending a transfer — not by the read-only `repairs` feature.
- The Send screen must render a failed search as an error with Retry, never as "No verified dealer found"; a stale production API answering 404 on `/api/dealers/directory` looked exactly like "dealer not registered" to users.

**Why:** Sept 2026 report: number search found nobody even for registered dealers. Three causes stacked: production API not republished (404), owner's shop excluded because the owner is `super_admin`, and formatted numbers (`+91 …`) falling through to a name-ILIKE search.

**How to apply:** any new "find another shop" endpoint reuses `OWNER_ROLES` + `normaliseIndianMobile` + `requireFeature('repairs_update')`; after touching these routes, republish — installed APKs only talk to `api.avarpus.com`.
