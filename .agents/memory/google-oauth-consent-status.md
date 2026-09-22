---
name: Google OAuth consent-screen status
description: What Google's "Access blocked … has not completed the Google verification process" (Error 403 access_denied) means for the Drive backup connect flow, and why it is a Cloud Console setting, not an API bug.
---

# Google OAuth consent-screen status (Drive backup)

When connecting a Google account for chat backup shows Google's own page "Access blocked:
avarpus.com has not completed the Google verification process … Error 403: access_denied", the
cause is the OAuth consent screen's **publishing status = Testing** in the Google Cloud project that
owns the backup OAuth client. In Testing, only accounts on the test-user allowlist (hard cap 100)
can authorize; everyone else dead-ends on that page and our callback is never reached.

**Why:** the flow requests `openid`, `email` and `drive.file`. Google exempts Testing apps from the
allowlist only when they request basic identity scopes alone, so the Drive scope pulls the app under
the allowlist rule. All three scopes are non-sensitive, so moving the consent screen to
"In production" (Google Auth Platform → Audience → Publish app) needs no verification review;
brand verification is optional and only decides whether the name/logo show instead of the domain.

**How to apply:** reaching that Google page proves the client ID / redirect URI / env config are
fine (a mismatch would be a 400 `redirect_uri_mismatch` instead) — do not debug the API for it.
Adding test users is a stop-gap only: Testing-mode refresh tokens for non-identity scopes expire
after 7 days, which silently breaks scheduled backups. Observed 2026-09-22 (status was Testing).
