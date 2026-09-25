---
name: Repair list cover photos
description: How repair list cards get their thumbnail photo, and what must stay true when touching repair photos or the list projection.
---

**Decision (24 Sept 2026):** repairs list rows carry a server-projected `coverPhoto` (`{ objectPath, kind } | null`): the `front` shot when one exists, else the earliest upload — the same preference the detail screen's device tile uses. One `DISTINCT ON (repair_id)` query per page inside the staff projection (`withTransferContext`), never one photo request per row from the app.

**Why:** the user asked for the "first photo / front" on the list cards; per-row `/repairs/:id/photos` fetches would be N+1 on every scroll, and the app rule is "no data changes" — a read-only additive list field was the accepted minimum.

**How to apply:**
- Staff views only: portal projections (`portalRepairOut`) never include it and the portal isolation script lists `coverPhoto` among forbidden keys.
- The projection joins photo→repair on BOTH `repair_id` and `shop_id`; no DB constraint ties a photo's shop to its repair's shop, so a stray row stamped with another shop must never become a cover (tested in the shop isolation script).
- Anything that adds/removes repair photos must also invalidate the repairs list key (`getRepairsListQueryKey()` — the bare root matches every list variant), or an already-mounted list keeps a stale placeholder/cover. Intake (`new.tsx`) is safe because it `router.replace`s back to the list, which remounts it.
- Thumbnails fetch the ORIGINAL object through the authenticated storage route with a bearer header (`useAuthToken` + `storageUrlFor`); there is no server thumbnail pipeline (no image library in the API). Photo-heavy shops pay full-size downloads on first scroll (expo-image caches afterwards) — a resize endpoint is the known follow-up if this bites.
- The fullscreen viewer is the shared `PhotoViewerModal` (list + detail); it takes `{ uri, label }` and the token.
- Rows without a usable cover (none uploaded, older server without the field, failed image load) show a filled device-silhouette stand-in, never an empty frame or a lone icon — the user reads a bare icon as "photo missing". A load failure is retried on the next list refetch (failure keyed by refetch stamp), so an offline moment never pins the stand-in.
- The Expo preview and Expo Go talk to the PRODUCTION API by default (expo-simulator-api-routing.md): a new list projection field stays invisible there until the API is published, even though the dev API already returns it. Check the deployment's last start time before hunting a client bug.
