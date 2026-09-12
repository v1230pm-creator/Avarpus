---
name: Shared confirm dialog
description: How destructive confirmations work in the mobile app (ConfirmDialog provider/host) and the rules for adding new ones
---
**Rule:** Every destructive prompt in the mobile app (delete, discard, disconnect, cancel job) goes through `useConfirmDialog().confirm(...)`, never `Alert.alert`. Plain informational/error alerts may stay on `Alert.alert`.

**Why:** Sep 12 2026 — user asked for one exact dialog design (red round trash icon, title, "This action cannot be undone.", stacked uppercase actions with descriptions, outlined CANCEL) on every delete pop-up. Reviewers flagged any destructive Alert left behind as a scope gap.

**How to apply:**
- If the confirming code runs inside a screen's own `<Modal>`, mount `<ConfirmDialogHost />` as the last child of that Modal; sibling native Modals don't stack reliably on iOS. The host on top at `confirm()` time owns the request; host unmount cancels it (never re-shown on remount).
- Return the promise from async `onPress` (e.g. `mutateAsync`, not `mutate`) so the dialog shows a spinner and blocks double-taps; requests are id-scoped so an old promise can't close a newer dialog.
- Pass `caption: null` for reversible actions (e.g. disconnect backup) so the "cannot be undone" line is not shown falsely.
- Time-driven overlays (StatusViewer playback) must pause while the confirmation is open.
- Tests mock `useConfirmDialog` at the boundary (`jest.mock('@/components/ui/ConfirmDialog', () => ({...requireActual, useConfirmDialog: () => ({ confirm: mockConfirm })}))`) and assert on the options' `actions` labels/descriptions.
