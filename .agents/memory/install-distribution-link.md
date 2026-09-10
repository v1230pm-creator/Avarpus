---
name: Public install link for Avarpus
description: Which destination outsider-facing install links must use, and which hosts are banned from them.
---

The official Android distribution destination for people who do not have the app
yet is the managed download page on the public website (`avarpus.com/download`),
confirmed by the owner. Outsider-facing links (SMS invites, shared links,
marketing copy) must point there.

Never send a workspace preview domain (`*.replit.dev`), a generated deployment
subdomain, or an `exp://` Expo session URL to someone outside the workspace.

**Why:** those hosts rotate or disappear with the dev session, so a recipient who
opens the message later lands on a dead or wrong page. The authenticated
in-app APK update endpoint is also unusable here — recipients have no account
yet, so it cannot be the invite destination.

**How to apply:** when adding any user-visible install or download link, take it
from the shared mobile install constants (which validate the URL and fail closed
on a temporary host) rather than composing a URL inline. The website download
page must also resolve end to end — a landing page that loads but links to an
unreachable API host still leaves the recipient with no app.
