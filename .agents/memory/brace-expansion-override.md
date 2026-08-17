---
name: brace-expansion override scoping
description: Blanket dependency overrides for CVE fixes can break RN Android codegen on EAS
---
**Rule:** Never blanket-override `brace-expansion` (or similar deep deps) to one major across the workspace. Scope overrides per major in pnpm-workspace.yaml: `brace-expansion@1: 1.1.12`, `brace-expansion@2: 2.0.2`, `brace-expansion@>=3: 5.0.9`.

**Why:** Aug 17, 2026 — a CVE fix forced `brace-expansion: 5.0.9` everywhere; minimatch@3 (needs v1) crashed with "expand is not a function", killing every `generateCodegenSchemaFromJavaScript` gradle task on EAS Android builds.

**How to apply:** When fixing dependency CVEs via overrides, use per-major scoping so old consumers keep a compatible patched major. Reproduce EAS codegen failures locally by running `@react-native/codegen/lib/cli/combine/combine-js-to-schema-cli.js` against the failing library's src — no Android SDK needed.
