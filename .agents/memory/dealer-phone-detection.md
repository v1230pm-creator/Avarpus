---
name: Dealer phone auto-detection
description: Rules for auto-linking repairs to dealers by intake mobile
---
Repairs auto-link to a dealer server-side when the intake mobile exactly matches ONE active same-shop dealer (`dealer_detected_by_phone=true`). Rules reviewers/spec require:
- **Explicit `dealerId: null` from the client means "user removed the detected dealer"** — server must skip auto-detection; `undefined` means "server may auto-detect". Mobile intake tracks a `dealerCleared` flag and every removal path (detection card AND manual picker toggle-off) must set it, or the server silently re-links.
- Ambiguous (2+) matches are never auto-assigned; user picks from the match list.
- **Manual dealer links (POST and PATCH) are open to every shop staff role that holds `repairs_create`/`repairs_update`** (the old privileged-only rule and its 403 `DEALER_LINK_PRIVILEGED` were retired); a manual link is audit-logged and never carries the phone flag. The configurable staff roles are `reception`, `technician`, `store_manager`, `accountant` — there is no `staff` role, and seeding one yields 403 `FEATURE_DISABLED`.
- Inactive dealers never match; detection is shop-scoped; portal roles can't call detect, and the portal repair projection omits `dealerId` (compare portal lists by repair id).
- e2e coverage: `artifacts/api-server/scripts/test-dealer-detection.mjs`, registered as the `dealer-detection` validation step (it had silently dropped out of `.replit` once and rotted; the test-registration guard now fails completion if that happens again).
