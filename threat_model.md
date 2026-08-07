# Threat Model

## Project Overview

Early-stage Node.js monorepo (pnpm workspaces) with three artifacts:
- **API Server** – Express 5, TypeScript, PostgreSQL/Drizzle ORM. Currently has only a `/api/healthz` endpoint. Intended to grow into a full backend for a mobile repair-shop management app.
- **Mobile App** – Expo React Native business management app for a device repair shop ("VMC Electronic"). Manages staff, repairs, customers, inventory, and finance. Authentication and all data are currently stored **client-side only** using AsyncStorage (unencrypted on Android). No backend integration yet.
- **Mockup Sandbox** – Design/prototype area, dev-only.

Not yet deployed to production (no deployment record found).

## Assets

- **Staff credentials** – Usernames and passwords for all roles (Super Admin, Dealer, Reception, Technician, Store Manager, Accountant). Currently stored in unencrypted AsyncStorage. Compromise allows full app access including financial data.
- **Business data** – Repair job records (including device IMEI numbers), customer PII (names, addresses, mobile numbers, emails), inventory, financial records (income/expense). Stored in AsyncStorage.
- **Application secrets** – `DATABASE_URL` and any future API keys. Currently stored as environment variables on the server side.
- **Future server-side data** – As the API grows to backend-driven storage, server-side assets become primary attack targets.

## Trust Boundaries

- **Device / AsyncStorage** – The mobile app stores all data and credentials in AsyncStorage, which is unencrypted on Android. On a rooted device or via backup extraction, any data in AsyncStorage is fully readable.
- **Client / Server** – The Express API server currently serves only a health endpoint. As features migrate to the server, the server must authenticate and authorize every request. The client is untrusted.
- **API Server → PostgreSQL** – Direct database access via Drizzle ORM. SQL injection at the API layer gives full DB access.
- **Public → Static Asset Server** – The mobile static-file server (`serve.js`) serves bundled Expo assets. It must not expose files outside the static-build directory (currently enforced correctly).
- **Authenticated → Unauthenticated** – Authentication and role checks are currently client-side only; no server-side enforcement exists.

## Scan Anchors

- **Mobile entry points:** `artifacts/mobile/context/AuthContext.tsx`, `artifacts/mobile/context/DataContext.tsx`, `artifacts/mobile/app/(auth)/`
- **API entry points:** `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/`
- **Highest-risk code areas:** AsyncStorage credential handling (`utils/storage.ts`, `context/AuthContext.tsx`), CORS config (`app.ts`), default seed credentials (`utils/seedData.ts`)
- **Dev-only:** `artifacts/mockup-sandbox/` — skip unless proven production-reachable
- **Mobile static server** (`artifacts/mobile/server/serve.js`) — has correct path-traversal protections; low risk

## Threat Categories

### Spoofing / Authentication

The mobile app's authentication is entirely client-side. Passwords are compared in plaintext from AsyncStorage (`AuthContext.tsx` line 54: `u.password === password`). On a rooted Android device, any user's password can be extracted from AsyncStorage and used to authenticate as any role. Default seed credentials are hardcoded in source (`seedData.ts`) and rendered in the login UI (`app/(auth)/index.tsx`).

**Required guarantees:**
- Passwords MUST be hashed before storage (bcrypt or PBKDF2); plaintext comparison MUST be replaced with hash verification.
- The current user session MUST NOT include the `password` field (strip before storing the session object).
- The demo-credential panel MUST be gated to development builds only.
- When backend auth is added, all access-control checks MUST be server-side.

### Information Disclosure

All user passwords flow through `DataContext` into global React state and are accessible to every component via `useData().users`. Any crash report, log line, or developer tool that serializes this state will capture plaintext credentials for all staff.

The API server uses `cors()` with no configuration, defaulting to `Access-Control-Allow-Origin: *`. Once the API serves authenticated or sensitive data, any origin can cross-origin-read responses from an authenticated user's browser/WebView session.

**Required guarantees:**
- The `password` field MUST be stripped from user objects before they enter DataContext or any component state.
- CORS MUST be restricted to an explicit origin allowlist before sensitive endpoints are added.
- API error responses MUST NOT include stack traces or DB error details in production.

### Tampering

Business logic (role-based access, repair status transitions, financial calculations) is enforced client-side only. Any modification to the local AsyncStorage data allows full privilege escalation (e.g., changing a `reception` role to `super_admin`, setting `isActive: true`).

**Required guarantee:** When the backend is introduced, all authorization and business rules MUST be enforced server-side with server-managed state.

### Elevation of Privilege

No rate limiting or brute-force protection exists on the login function. An attacker with physical device access can attempt unlimited passwords. Role-based access control (`canAccess`) is client-side only — disabling JavaScript guards or modifying AsyncStorage bypasses it entirely.

**Required guarantees:**
- Add login attempt rate-limiting or lockout once the backend is integrated.
- All database queries MUST use Drizzle's parameterized query interface.
- Server-side role enforcement is required before any privileged routes are added.
