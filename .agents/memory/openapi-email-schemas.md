---
name: OpenAPI email schemas
description: Compatibility rule for documenting email inputs while Orval generates validators for the current Zod version.
---

While `api-zod` remains on Zod 3, model email validation in OpenAPI with the server's regex pattern rather than `format: email`.

**Why:** The current Orval generator translates `format: email` into the Zod 4-only `zod.email()` API, so an otherwise valid code-generation run fails the shared-library typecheck.

**How to apply:** Use a string `pattern` matching the server boundary for request fields that require email validation. Revisit this rule only after the generated validator package imports and typechecks against Zod 4.