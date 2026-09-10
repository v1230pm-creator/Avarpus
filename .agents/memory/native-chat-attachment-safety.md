---
name: Native chat attachment safety
description: Gesture, privacy, and permission rules for native chat attachment sheets.
---

Scope bottom-sheet drag responders to the handle or header rather than the whole sheet whenever the sheet contains a vertical gallery. Device media must be cursor-paginated, and precise location must require an explicit send confirmation after coordinates are obtained.

**Why:** A parent PanResponder can capture vertical movement and make a nested Recents grid impossible to scroll. Treating denied media access as an empty library misleads users, and sending GPS coordinates on the first tap can disclose precise location by mistake.

**How to apply:** Track granted, limited, denied, unavailable, and error media states separately; provide settings or retry recovery; preserve nested scroll ownership; and add a confirmation step immediately before any precise-location message is sent.

Android pickers and MediaLibrary may return provider/content URIs with missing or zero file sizes. Never send that metadata to the upload API: materialize unreadable provider URIs into app cache, stat the actual upload file, and expose Send only after a positive finite size is known.

**Why:** A selected photo can look valid while its picker metadata reports `0 B`; sending that value causes an immediate validation failure before any bytes upload.

**How to apply:** Treat non-positive picker size as unknown, use the resolved cached URI for preview and upload, keep upload explicit behind the Send action, and defend again before requesting a presigned URL.