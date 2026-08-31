---
name: Native chat attachment safety
description: Gesture, privacy, and permission rules for native chat attachment sheets.
---

Scope bottom-sheet drag responders to the handle or header rather than the whole sheet whenever the sheet contains a vertical gallery. Device media must be cursor-paginated, and precise location must require an explicit send confirmation after coordinates are obtained.

**Why:** A parent PanResponder can capture vertical movement and make a nested Recents grid impossible to scroll. Treating denied media access as an empty library misleads users, and sending GPS coordinates on the first tap can disclose precise location by mistake.

**How to apply:** Track granted, limited, denied, unavailable, and error media states separately; provide settings or retry recovery; preserve nested scroll ownership; and add a confirmation step immediately before any precise-location message is sent.