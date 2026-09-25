---
name: Mobile Jest setup quirks
description: How to make jest-expo work in this pnpm monorepo without hangs
---
- transformIgnorePatterns must account for the pnpm store layout: use `node_modules/(?!(?:\.pnpm/)?(...))` — the default expo pattern never matches files under `node_modules/.pnpm/...`.
- **Why:** plain patterns caused "Cannot use import statement outside a module" from react-native/jest/setup.js.
- Enable `fakeTimers.enableGlobally` in jest config; otherwise RN/screen intervals leave open handles and Jest never exits (reviewers reject `--forceExit`).
- Mock at the API-client (network) boundary and render the real AuthProvider — reviewers reject tests that mock context methods directly.
- API tests: Vitest + Supertest against the real dev DB works; mock `../lib/mailer` with vi.mock; run rate-limit lockout tests LAST (in-memory per-IP failure counters poison earlier login tests).
- `react-native-keyboard-controller` needs a manual mock in `jest.setup.js` (registered via `setupFiles`): the official `/jest` mock is incomplete for this app — also export `KeyboardAvoidingView` (View passthrough), `useKeyboardHandler`, `useKeyboardContext`, or consumers render `undefined` components.
- UI tests script exact labels/placeholders/flows; after any screen redesign (section toggles, renamed buttons, payment-gated delivery confirm Alert) update the test scripts — "Unable to find text" failures are usually product drift, not mock breakage.
- Jest testMatch only picks up `__tests__/**/*.test.tsx` — name new test files .test.tsx even when they contain no JSX, or they silently never run.

**React Query under global fake timers:** observer notifications are batched behind a zero `setTimeout`, so after `queryClient.refetchQueries()`/`invalidateQueries()` in a test the screen does NOT re-render until you `jest.advanceTimersByTime(10)` inside `act`. Also advance the clock before the refetch if the assertion depends on `dataUpdatedAt` changing (frozen fake clock → identical stamp).

