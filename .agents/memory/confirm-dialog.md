---
name: Shared confirm dialog
description: How destructive confirmations work in the mobile app (ConfirmDialog provider/host) and the rules for adding new ones
---
**Rule:** Every destructive prompt in the mobile app (delete, discard, disconnect, cancel job) goes through `useConfirmDialog().confirm(...)`, never `Alert.alert`. Informational/error pop-ups on a screen the user has asked to polish go through `useConfirmDialog().notice(...)` (same card: tone-tinted icon, filled OK, no CANCEL, no "cannot be undone" line). The Service Form was the first screen converted (Sep 24 2026); other screens still use `Alert.alert` until asked.

**Why:** Sep 12 2026 — user asked for one exact dialog design (red round trash icon, title, "This action cannot be undone.", stacked uppercase actions with descriptions, outlined CANCEL) on every delete pop-up. Reviewers flagged any destructive Alert left behind as a scope gap.

**How to apply:**
- If the confirming code runs inside a screen's own `<Modal>`, mount `<ConfirmDialogHost />` as the last child of that Modal; sibling native Modals don't stack reliably on iOS. The host on top at `confirm()` time owns the request; host unmount cancels it (never re-shown on remount).
- Return the promise from async `onPress` (e.g. `mutateAsync`, not `mutate`) so the dialog shows a spinner and blocks double-taps; requests are id-scoped so an old promise can't close a newer dialog.
- Pass `caption: null` for reversible actions (e.g. disconnect backup) so the "cannot be undone" line is not shown falsely.
- `notice()` dismissal semantics: backdrop/back runs the lone action's `onPress` (a single OK that navigates must not be skippable); with several actions, dismiss only closes. Pass `onDismiss` to override. Never pass a `cancelLabel` to a notice unless a real "back out" exists.
- The card head (icon/title/message) scrolls inside a `maxHeight: 100%` card; keep long server error text in `message`, never in `title`.
- Time-driven overlays (StatusViewer playback) must pause while the confirmation is open.
- Tests that render a screen for real must wrap it in `ConfirmDialogProvider` and mock `expo-linear-gradient` (the card is a gradient); assert on `testID="confirm-dialog"` + title text, and close notices via their OK before continuing the flow. Otherwise tests mock `useConfirmDialog` at the boundary (return both `confirm` and `notice`) (`jest.mock('@/components/ui/ConfirmDialog', () => ({...requireActual, useConfirmDialog: () => ({ confirm: mockConfirm })}))`) and assert on the options' `actions` labels/descriptions.


**Test fallout:** when a screen first adopts `useConfirmDialog`, every existing test that renders it directly must wrap it in `ConfirmDialogProvider` (or mock the hook) — the hook throws without the provider and the failure looks unrelated.
