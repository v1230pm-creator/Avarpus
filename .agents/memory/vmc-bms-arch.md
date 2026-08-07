---
name: VMC BMS Architecture
description: Durable auth and architecture decisions for the VMC Electronic BMS project.
---

# VMC Electronic BMS — Architecture

## Auth (real, backend-driven)
- **Sessions**: opaque 48-byte hex bearer tokens stored in a `sessions` table (PostgreSQL via drizzle). 30-day TTL.
- **Passwords**: bcryptjs at rest; OTP codes and reset tokens stored as sha256 hashes only.
- **OTP email delivery**: Resend via `@replit/connectors-sdk` proxy (`ReplitConnectors` instance created per call, never cached). Default `from` address comes from `MAIL_FROM` env var; falls back to `onboarding@resend.dev` (Resend's test sender). Set `MAIL_FROM` to a verified domain address once the domain is confirmed in Resend.
- **Anti-enumeration rule**: OTP-request and forgot-request endpoints must return the same response body/status regardless of whether the identifier exists. Any email-send failure inside these handlers must be swallowed and logged — never propagated to the caller.
- **Registration flow**: single email-OTP step only (not two-step email+phone). New accounts land as `role: reception, isActive: false` pending admin approval.
- **Seed users**: api-server seeds 6 demo users with hashed passwords on boot if `users` table empty.

## Database schema & migrations
- Tables: `users`, `sessions`, `otp_codes` — defined in `lib/db/src/schema/`.
- Migrations: generated in `lib/db/migrations/` by `drizzle-kit generate`. The api-server build step copies `lib/db/migrations/` into `dist/migrations/` so the drizzle migrator can reach them at runtime.
- **Startup sequence**: `migrate(db, { migrationsFolder })` runs before the server begins accepting requests and before seeding — server exits on migration failure. Migration SQL uses `CREATE TABLE IF NOT EXISTS` so it is safe to re-run against a pre-existing database.

**Why:** The `drizzle-kit push` approach (previously used manually) leaves no migration journal. On a fresh database there was no automated step to create tables before seeding, so every auth call failed until someone ran push manually. The migrator + `dist/migrations/` copy pattern is reproducible across deploys.

## Session management
- Sessions are short-lived by default; "Remember me" (sent by both password and OTP login) is the only way to get the long 30-day TTL. Successful logins are audited server-side and surfaced to the user in Settings.
- Inactivity auto-lock is enforced client-side at the tabs boundary; on timeout it locks to PIN when a lock is configured (fail closed) and fully logs out otherwise. The tabs layout must react to lock-state *changes* (subscription), not just check once on mount — a one-shot check leaves a relock bypass after unlock, and reviewers reject that.

## Mobile → API connection
- Base URL configured at app module level via `setBaseUrl` / `setAuthTokenGetter` from `@workspace/api-client-react`.
- Bearer token stored in AsyncStorage key `vmc_auth_token`.
- Boot flow: read token → `authMe` → set user; clear token on failure.

## Non-auth data
- Repairs, customers, inventory etc. still seed to AsyncStorage via `utils/seedData.ts` — DataContext reads from there. Auth no longer reads `KEYS.USERS` for login decisions.
