---
name: API validation steps
description: How the shop-isolation / customer-balances / registration-gate validation commands are registered and why they need flock serialization.
---

Registered validation steps `shop-isolation`, `customer-balances`, `registration-gate` each run:
`cd artifacts/api-server && flock /tmp/api-server-tests.lock sh -c 'pnpm run build && node scripts/<script>.mjs'`

**Why:** validation commands run concurrently and share one `dist/` — unserialized builds clobber each other (ENOENT/MODULE_NOT_FOUND mid-copy). The lock must wrap build+test, not just build, because a sibling rebuild while a test's server is starting also breaks it. Scripts resolve `dist/index.mjs` relative to cwd, so they must run from `artifacts/api-server`.

**How to apply:** any new api-server script registered as a validation step must use the same cwd + whole-command flock pattern. Test-script API contracts to honor: delivery requires the testing gate (`POST /repairs/:id/testing {confirm:true}`) unless already `ready`; advance only via `POST /repairs/:id/payments` (methods are capitalized: "Cash", "UPI"…), overpayment → 400 OVERPAYMENT; registration is dealer/staff-only with no admin access code.
