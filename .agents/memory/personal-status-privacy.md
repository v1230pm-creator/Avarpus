---
name: Personal Status privacy
description: Privacy and lifecycle invariants for Avarpus 24-hour personal Status updates.
---

Status visibility comes only from an active global direct-chat relationship. Shop rooms and Shop membership never grant access, and a block by either participant removes feed, item, view, and media access.

Viewer identity and totals belong to the status author. Contacts may record their own view but must not learn viewer lists or aggregate counts for somebody else's status.

Private media authorization must verify the active database status, unexpired time, audience/contact relationship, both block directions, and an active author. Manual deletion must hide the row before deleting bytes. Failed byte cleanup keeps an invisible tombstone so later feed cleanup retries rather than exposing or forgetting retained media.

**Why:** Status combines personal social visibility with private object storage. Applying only Shop scoping, only row visibility, or only object-path ownership leaves cross-context and cached-URL privacy gaps.

**How to apply:** Any new Status endpoint, audience mode, media path, background cleanup, or account-deactivation flow must preserve these checks at both the API-row and storage-serving boundaries.