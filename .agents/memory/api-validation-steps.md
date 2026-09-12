---
name: API validation steps
description: How the api-server integration test scripts are registered as validation steps, why each run builds into a private directory, and which script contracts they rely on.
---

Registered API-server validation steps (shop-isolation, customer-balances, registration-gate, stage-locks, portal-repair-isolation, public-requests, chat-blocks, chat-reports, push-delivery) each run:
`cd artifacts/api-server && flock /tmp/api-server-tests.lock node scripts/run-isolated.mjs scripts/<script>.mjs`

**Why:** validation commands run concurrently with each other, the api-server dev workflow, and `workspace-build`, and all of those rewrite `artifacts/api-server/dist/`. A test that had just built into `dist/` would find `dist/index.mjs` gone when it spawned the server (`Cannot find module .../dist/index.mjs` right after a successful build). Serialising builds with flock is not enough because builds outside the test lock still clobber `dist/`. The fix is ownership, not locking: `run-isolated.mjs` builds into `tmp/isolated-builds/<run-id>/` (via `API_SERVER_OUT_DIR`, which build.mjs only accepts inside the artifact so externals still resolve from its node_modules) and hands the entry to the script through `API_SERVER_ENTRY`. The tests lock remains only to keep the suites' fixed ports and shared dev database from contending.

**How to apply:** any new api-server integration script must read `process.env.API_SERVER_ENTRY ?? "./dist/index.mjs"` for its spawn target and be registered through `run-isolated.mjs`, never `pnpm run build && node scripts/...`. Scripts resolve relative to cwd, so they must run from `artifacts/api-server`. Test-script API contracts to honor: delivery requires the testing gate (`POST /repairs/:id/testing {confirm:true}`) unless already `ready`; advance only via `POST /repairs/:id/payments` (methods are capitalized: "Cash", "UPI"…), overpayment → 400 OVERPAYMENT; registration is dealer/staff-only with no admin access code.

Related browser-suite lesson: Radix toast text is duplicated into a visually hidden announcer portaled outside the `Notifications` region for a timing-dependent moment, so unscoped `getByText(toast copy)` intermittently hits two elements. Scope toast assertions to `page.getByRole("region", { name: /notifications/i })`.
