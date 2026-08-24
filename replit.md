# Avarpus

Repair-shop management for customer intake, repairs, inventory, finance, and customer notifications.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required for customer email: `MAIL_FROM` — verified Avarpus sender (see "Email sender configuration" below)

## Email sender configuration

OTP emails and customer notifications are sent via the Resend integration. The sender address comes from the `MAIL_FROM` workspace configuration:

- If `MAIL_FROM` is not set, the server falls back to `Avarpus <onboarding@resend.dev>` and logs a startup warning. With this fallback, Resend only delivers to the Resend account owner's own email address — real users will NOT receive OTPs.
- The currently verified Resend domain is `vmcelectronic.com`. The configured sender is `Avarpus <noreply@vmcelectronic.com>`.
- To change the domain or sender:
  1. Verify the domain in Resend (Domains → Add Domain, then add the DNS records it shows).
  2. Set `MAIL_FROM` to a sender on that verified domain, using the Avarpus display name; for example, `Avarpus <noreply@example.com>`.
  3. Restart the API server.
- Changing the sender requires only updating the workspace configuration — no code deploy.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
