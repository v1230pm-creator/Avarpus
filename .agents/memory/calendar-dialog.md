---
name: In-house CalendarDialog
description: Why the Service Form's date picker is a custom Modal month grid and the conventions icon-only header chips follow.
---

**Rule:** date picking in the mobile app uses `components/ui/CalendarDialog.tsx` (Modal month grid, UTC calendar days via `utils/helpers` date strings, inclusive `minDate`/`maxDate`, selecting a day reports it and closes). No `@react-native-community/datetimepicker` or other native picker dependency.

**Why:** the date strings in the app are UTC calendar days (`getTodayStr`/`getNextWeekStr`); a native picker works in the device's local zone and needs a custom-dev-client build, so it cannot be exercised in Expo Go, on the web preview, or in Jest. The user also asked for the chosen date to stay hidden on the form ("icon only; calendar opens, pick, closes").

**How to apply:** icon-only header chips (calendar, priority flag) must put the current value in their `accessibilityLabel` (`Expected delivery date: 1 October 2026`, `Priority: Normal`) so the choice is still reviewable before the summary step; tests find them with a `/^Expected delivery date: /` regex. Use the ConfirmDialog scrim colour for the backdrop — there is no `colors.overlay` token.
