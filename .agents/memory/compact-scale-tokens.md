---
name: Compact scale tokens (mobile)
description: Decisions behind the app-wide compact spacing/typography scale in artifacts/mobile and the traps hit while sweeping ~90 screens onto it.
---

**Rule:** `constants/spacing.ts` + `constants/typography.ts` are the only source of the mobile scale (reference: a 360dp messenger inbox — 56 app bar, 47 pill search, 78 rows / 50 photos, 32 chips, 56 FAB). Screens must not carry a private scale module (the old Chats-only constants file was folded in and deleted).

**Why:** the user asked for the Chats-tab measurements to be applied to every screen; with ~700 token uses but 370 literal `fontSize`s the app drifted per screen. A single table plus a role mapping made a 7-worker parallel sweep possible in one pass.

**How to apply / traps:**
- Role mapping is by *purpose*, not by old number — but keep 3-column form labels on `font.caption` (13); mapping them to `font.label` (14) wraps "Device Type *" at 360dp.
- 32dp chips are visual only: every chip touchable takes `hitSlop={hitSlop.chip}` (exported from spacing.ts) to reach 44dp. Form choice options (`SelectInput`) and `buttonSm` stay 44dp — reviewers reject <44dp tappables without slop.
- hitSlop never reaches past the touchable's *parent* bounds: a 32dp chip inside a 32dp header row still has a 32dp target (reviewer FAIL). Give the row `minHeight: size.iconButton` (pull it into the card padding with negative `space` margins if the layout must stay compact) or wrap the pill in a 44dp transparent touch box.
- Dense card fields use `Input dense` (`size.inputSm` = 44, caption label) — 44 not 40, to keep the touch minimum without slop.
- When moving `paddingHorizontal` from a header container to its rows, horizontal chip lists (`FlatList horizontal`) lose their inset — grep `contentContainerStyle={{ gap` after such moves.
- Header rows with a title plus a trailing button (`Link Dealer`) must `flexWrap`; name + role-tag rows must `flexWrap` too, otherwise the name shrinks to "Sun…" before the tag yields.
- Expo-web spot checks: `/status` is Metro's own endpoint — use `/(tabs)/status`; several deep routes redirect to the Chats tab on web (khata, chat-storage, forward) so screenshot them via their tab entry instead.
- Worker Jest runs only cover their own suites; run the full 42-suite Jest once at the end under the heavy-checks lock (it passed unchanged — no test asserts style values, so screenshots are the real check).
