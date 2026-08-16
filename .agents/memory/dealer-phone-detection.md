---
name: Dealer phone auto-detection
description: Rules for auto-linking repairs to dealers by intake mobile
---
Repairs auto-link to a dealer server-side when the intake mobile exactly matches ONE active same-shop dealer (`dealer_detected_by_phone=true`). Rules reviewers/spec require:
- **Explicit `dealerId: null` from the client means "user removed the detected dealer"** — server must skip auto-detection; `undefined` means "server may auto-detect". Mobile intake tracks a `dealerCleared` flag and every removal path (detection card AND manual picker toggle-off) must set it, or the server silently re-links.
- Ambiguous (2+) matches are never auto-assigned; user picks from the match list.
- **Manual dealer links are privileged-only** (POST and PATCH): non-privileged staff may only supply a dealerId the server can verify by exact phone match, else 403 `DEALER_LINK_PRIVILEGED`. Mobile hides the manual picker for staff.
- Inactive dealers never match; detection is shop-scoped; portal roles can't call detect.
- e2e coverage: `artifacts/api-server/scripts/test-dealer-detection.mjs` (run with flock + built dist).
