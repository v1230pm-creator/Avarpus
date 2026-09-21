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
- Required for Resend delivery monitoring: `RESEND_WEBHOOK_SECRET` — signing secret for the configured Resend webhook (see below)

## Email sender configuration

OTP emails and customer notifications are sent via the Resend integration. The sender address comes from the `MAIL_FROM` workspace configuration:

- If `MAIL_FROM` is not set, the server falls back to `Avarpus <onboarding@resend.dev>` and logs a startup warning. With this fallback, Resend only delivers to the Resend account owner's own email address — real users will NOT receive OTPs.
- The currently verified Resend domain is `vmcelectronic.com`. The configured sender is `Avarpus <noreply@vmcelectronic.com>`.
- To change the domain or sender:
  1. Verify the domain in Resend (Domains → Add Domain, then add the DNS records it shows).
  2. Set `MAIL_FROM` to a sender on that verified domain, using the Avarpus display name; for example, `Avarpus <noreply@example.com>`.
  3. Restart the API server.
- Changing the sender requires only updating the workspace configuration — no code deploy.

## Resend delivery monitoring

Registration verification emails carry non-sensitive routing tags. Resend delivery events are accepted only at `POST /api/webhooks/resend` after Svix signature verification; raw event bodies, email subjects, and OTP codes are never stored.

To enable monitoring:

1. In Resend, create a webhook pointing to the published API URL followed by `/api/webhooks/resend`.
2. Subscribe it to `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`, and `email.delivery_delayed`.
3. Save the webhook signing secret as the `RESEND_WEBHOOK_SECRET` workspace secret, then restart the API server.

For a failed staff-registration verification email, active shop owners see an in-app notification with the recipient and safe delivery reason. Webhooks are deduplicated by their provider event ID so provider retries never create duplicate alerts.

## Android app identity: com.avarpus.app

The mobile app ships as Android package / iOS bundle identifier `com.avarpus.app` with URL scheme `avarpus` (`artifacts/mobile/app.json`). The legacy identity `com.vmcelectronicerp.app` / scheme `vmcelectronicerp` is retired: nothing in the repo may reference it.

Because Android treats a new package name as a different app, **existing installs of the old identity will not upgrade in place**. Users must install the new app from the official download page and sign in again with OTP. There is no in-app migration or reinstall banner in the old app.

Before building the first release under the new identity, complete these out-of-repo steps (they need the operator's Firebase, EAS, and Google Cloud accounts):

1. **Firebase**: in the Firebase project, add an Android app with package name `com.avarpus.app` (the old `com.vmcelectronicerp.app` app does not carry over). Download its `google-services.json`.
2. **EAS file variable**: replace the `GOOGLE_SERVICES_JSON` EAS file environment variable with the new `google-services.json`. The release-build guard in `artifacts/mobile/app.config.js` refuses to build without it; a build made with the old file would install but never obtain a push token.
3. **EAS credentials**: in the EAS project's Android credentials, assign the existing upload keystore to `com.avarpus.app` (EAS keys credentials by application id; the keystore is held by the operator). Do not let EAS generate a fresh keystore unintentionally. The build must run on the EAS project named by `owner` + `extra.eas.projectId` in `app.json` (`julian647` / `ebcf3946-…`); that is where the keystore, FCM V1 service-account key and `GOOGLE_SERVICES_JSON` variable are configured.
4. **Drive backup OAuth client**: the Google OAuth client used for Drive backup (`GOOGLE_BACKUP_CLIENT_ID`) is a web client completing on the API server and returning to the app via `avarpus://google-backup`; confirm it has no Android package/SHA-1 entry that still names the old package. Nothing else needs changing there.
5. **Build and release**: build a fresh APK, then publish it through the update admin as a new release with a new `versionCode`, the actual native version/build, and a fresh checksum. Point the official website download page at it; release labels alone never change APK contents.

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
