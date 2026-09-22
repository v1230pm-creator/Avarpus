---
name: Test registration guard
description: How the completion-time guard decides a test file is "run", the fail-closed rules it applies, and the vitest CLI quirk that shaped the avarpus-web catch-all.
---

**Rule:** every `*.test.*` / `*.spec.*` file and every `test-*.{js,mjs,ts}` script under a package's `scripts|test|tests|e2e|__tests__` dir must be reached by an `isValidation = true` workflow in `.replit`; the `test-registration-guard` step (`node scripts/src/check-test-registration.mjs`, `--verbose` for the resolution trace) fails completion otherwise. Only `.replit` validation workflows count — a `package.json` script that nothing in `.replit` invokes is not coverage.

**Why:** two api-server spawn scripts (`test-customer-khata`, `test-dealer-detection`) and one web dom suite had silently dropped out of completion; one of them rotted for months (stale role name and a retired 403 code) because nothing ran it. A file list in a step command or a per-file `test:*` script is exactly the shape that drifts.

**How to apply:**
- Resolution is static: it peels `flock`/`cd`/`sh -c`/`CI=1`/`npx`, follows pnpm `run`/`--filter`/`-r`/pre-post hooks, then reads runner discovery from config. Keep discovery readable — Vitest `test.include` a literal string array; Jest `testMatch`/`testRegex` explicit in the package config (a preset-supplied one, `--findRelatedTests`, `vitest related`, multi-project configs are reported as unfollowable = failure); bare runner scripts (update-admin `run-browser-suites.mjs`) are credited only for suite file names they mention in string literals.
- Vitest 3 CLI positionals are substring filters, not globs: `vitest run "scripts/**/*.dom.test.tsx"` matches nothing. Use config `include` (default include already covers `scripts/*.dom.test.tsx`) and let the guard credit the catch-all.
- A test file in a package with no runner step (e.g. `lib/*`) fails the guard until a catch-all runner script plus a step exist; the failure output prints the exact step command to register for api spawn scripts.
- Negative check when touching the guard: drop `lib/db/src/x.test.ts` and `artifacts/api-server/scripts/test-x.mjs`, run the step, expect both listed with hints; delete them again.
