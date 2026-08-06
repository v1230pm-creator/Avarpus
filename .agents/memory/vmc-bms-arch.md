---
name: VMC BMS Architecture
description: Key decisions and structure for the VMC Electronic BMS Expo mobile app.
---

## Data layer
- All data lives in AsyncStorage via `utils/storage.ts` (typed `get/set/remove`).
- `KEYS` object in `storage.ts` contains all storage keys (USERS, REPAIRS, CUSTOMERS, INVENTORY, PURCHASES, FINANCE).
- `utils/seedData.ts` seeds 6 users, 6 customers, 8 repairs, 10 inventory items, 4 purchases, 8 finance entries on first launch (`seedIfNeeded()`).
- `DataContext` exposes: `repairs, customers, inventory, purchases, finance, users` (arrays) + add/update functions.
- `AuthContext` exposes: `user, isAuthenticated, isLoading, login, logout, canAccess(feature: string)`.

**Why:** First-build rule in Expo skill = frontend-only; no backend/API needed until user requests it.

## Navigation
- Root `app/_layout.tsx` wraps with `AuthProvider` + `DataProvider`.
- `app/index.tsx` redirects to `/(auth)` or `/(tabs)` based on `isAuthenticated`.
- Auth stack: `/(auth)/index.tsx` (login), `/(auth)/otp.tsx`, `/(auth)/register.tsx`.
- Tabs: 5 tabs (Dashboard, Repairs, Customers, Inventory, More). Each of Repairs/Customers/More is a nested Stack.
- More stack screens: finance, staff, reports, settings, purchases.

## Role permissions (canAccess map)
- `super_admin`: everything
- `dealer`: dashboard, repairs, inventory, customers, finance, staff, reports, settings, purchases, attendance, backup, profit, income, expense
- `reception`: dashboard, repairs, customers
- `technician`: dashboard, repairs_assigned, repairs_update
- `store_manager`: dashboard, inventory, purchases
- `accountant`: dashboard, finance, reports, income, expense, profit

**How to apply:** Always gate UI sections with `canAccess('feature')`. Technicians see only their assigned repairs (filtered by `technicianId === user.id`).

## Color tokens
Dark theme: bg=`#0B0E1A`, card=`#111827`, primary=`#1A56DB`.
All screens use `useColors()` hook — never hardcode colors.
Available extra tokens: `successLight`, `warningLight`, `infoLight`, `success`, `warning`, `info`, `destructive`.

## Component API notes
- `StatCard` `iconColor` accepts: `primary | success | warning | error | info | muted`.
- `Badge` `variant` accepts: `default | success | warning | error | info | muted`.
- `SelectInput` renders horizontal chips; use `labelMap` for human-readable labels.
- `Button` has `size="lg"` and `fullWidth` props.

## Shadow deprecation warning
`shadow*` RN style props produce a console warning on web — cosmetic only, not an error. Acceptable for now.
