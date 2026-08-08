---
name: Mobile Jest setup quirks
description: How to make jest-expo work in this pnpm monorepo without hangs
---
- transformIgnorePatterns must account for the pnpm store layout: use `node_modules/(?!(?:\.pnpm/)?(...))` — the default expo pattern never matches files under `node_modules/.pnpm/...`.
- **Why:** plain patterns caused "Cannot use import statement outside a module" from react-native/jest/setup.js.
- Enable `fakeTimers.enableGlobally` in jest config; otherwise RN/screen intervals leave open handles and Jest never exits (reviewers reject `--forceExit`).
- Mock at the API-client (network) boundary and render the real AuthProvider — reviewers reject tests that mock context methods directly.
- API tests: Vitest + Supertest against the real dev DB works; mock `../lib/mailer` with vi.mock; run rate-limit lockout tests LAST (in-memory per-IP failure counters poison earlier login tests).
