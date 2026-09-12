---
name: Request validation conventions
description: How API route input validation is structured, the traps hit while standardising it, and why upload limits must be re-checked at attach time.
---

Route bodies/queries go through the shared parse helpers in the API's `lib/validate` module using
the generated `@workspace/api-zod` `*Body` schemas (source of truth is `lib/api-spec/openapi.yaml`).
Stricter manual checks (normalisation, cross-field rules, DB lookups) stay in the handler after
the parse.

**Why:** hand-rolled `req.body ?? {}` destructuring silently accepted wrong types and let malformed
UUIDs reach Postgres (22P02 → 500). Tying validation to the OpenAPI schema also keeps client types
honest — tightening a schema immediately surfaces as a client typecheck error.

**How to apply / traps:**
- Contract patterns describe the *stored* form. If a handler normalises before validating
  (e.g. trims + lowercases a username), do not let the generated regex run on the raw input — extend
  the schema locally for that field and validate after normalisation, or clients that send mixed
  case start failing.
- Tightening a schema breaks tests that relied on the old lenient behaviour (probes sending an empty
  body, tests asserting a handler's old error prose). Update the probe/test, not the schema.
- UUID path guards are per-router (`router.param` does not propagate to mounted child routers), and
  some `:id` routes accept the literal `me` as a self-reference (customer-portal khata). Use the
  UUID-or-self variant on those routers; a strict guard 404s the whole customer portal.
- `router.param` runs before route middleware, so a malformed id answers 404 even without auth.
  That is acceptable (nothing is disclosed) but do not put anything data-dependent in a param guard.
- Upload-URL endpoints only validate the client's *claimed* size/type; the signed PUT enforces
  nothing. Every attach endpoint must re-verify the stored object (size cap, content type, magic
  bytes) via the shared upload-policy helper and delete rejects. Keep issuance and verification caps
  in the same constants — they drifted (5 MB vs 10 MB) once already.
