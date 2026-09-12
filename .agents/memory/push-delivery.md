---
name: Push delivery
description: Rules for fanning in-app notification rows out to device push without duplicating wording, leaking detail, or outliving a session.
---

Push is a copy of a notification row, never an independent message.

**Why:** safety alerts (abuse-report outcomes) are deliberately outcome-neutral in the
inbox. A push composed separately drifts from that wording and can reveal the decision on
a lock screen. Two copies of the same sentence also rot apart silently.

**How to apply:**
- Producers pass the row's own `type/title/body/data` to the push dispatcher. The push
  layer formats nothing.
- Push only for rows actually inserted — take the recipients from `.returning()`, not from
  the intended audience, or `onConflictDoNothing` dedupe re-buzzes the device on retries.
- Payload data is a routing hint: scalars only, key- and length-capped. Never more than the
  row holds.
- Dispatch is fire-and-forget and happens **after** commit. A producer that writes rows
  inside its own transaction must return the recipients and push outside it.

Tokens are bound to the session, not just the account.

**Why:** sign-out, single-device revocation and revoke-all must all stop delivery, and no
one remembers to add a fourth cleanup path. A session FK with `ON DELETE CASCADE` makes
every existing revocation path drop tokens for free.

**How to apply:**
- Token is the primary key, so a phone signing in to a second account moves the row instead
  of holding both. Otherwise the previous account's alerts keep arriving on that handset.
- The cascade is not enough on its own: expired sessions linger until scheduled cleanup, so
  the send query must join sessions and require an unexpired one.
- Registration routes are personal, not workspace-scoped — they need the personal path
  prefix in auth middleware and an entry in both portal contracts, or portal accounts get
  403 when they try to register.

Mobile registration must be invisible when it cannot work.

**Why:** the native module only exists in a signed build. Expo Go and any already-installed
older build must skip it silently; a static import at startup kills the app before an error
boundary can explain why. Server-side changes ship with Publish, but the phone side needs a
new build.

**How to apply:** lazy `require` behind an execution-environment check, every failure
swallowed, and re-registration on each session restore (tokens rotate and OS permission can
be withdrawn between launches). When permission is gone, unregister rather than leaving the
server pushing into a void.
