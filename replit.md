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

## Chat media relay purge

The server is a temporary relay for chat photos, videos, voice notes and files; phones keep their own copy and report `stored`. A daily job (`artifacts/api-server/src/lib/chatRelayCleanup.ts`, rules in `chatRelayPolicy.ts`) deletes the relay object and marks the message `purged` once every recipient has stored it and the grace period has passed, or `expired` after the hard cap regardless. Message text and metadata are never removed. Media under an open abuse report is pinned and untouched until the report is actioned or dismissed; delete-for-everyone removes the relay copy immediately (unless pinned; the terminal report decision then removes it). Every run also sweeps delete-for-everyone tombstones that still hold an object, **regardless of the master switch** — deleted content must never be retained because the lifecycle rules are off. Any storage error other than "not found" leaves the row untouched and ends the run.

- Operator controls: Update Admin → Settings → "Chat media relay purge" (`app_settings` keys `chat_relay_cleanup_enabled`, `chat_relay_grace_days`, `chat_relay_expiry_days`; per environment). Defaults: **off**, grace **7** days, expiry **30** days (grace 1–365, expiry 1–3650, expiry ≥ grace). "Run now" and the last-run summary (bytes reclaimed) live on the same card.
- Run history and trend: every **whole-relay** run (daily timer or Run now, but not room-scoped purges such as a room clear) is appended to `chat_relay_runs` (`artifacts/api-server/src/lib/chatRelayHistory.ts`) with its counters, bytes reclaimed, trigger, skip reason, abort error and a snapshot of what the relay still held afterwards; a switched-off run that removed nothing is not recorded (one that still swept deleted-message files or failed is), while a run skipped by the build guard is recorded so the table shows the purge was blocked. The history is bounded to **90 days / 500 rows** (code constants; pruned on each write) and served by `GET /api/settings/chat-relay/history` together with live held figures (objects, bytes, unknown-size legacy rows, pinned evidence). Recording is fail-safe: a history or measurement failure is logged and never aborts or fails a purge run, and `app_settings.chat_relay_last_run` is still written. Update Admin → Settings → "Relay storage over time" folds the runs client-side (operator local days; 7/30/90-day range) into bytes reclaimed per day, collected-vs-expired share (with a warning when expired dominates), what is still held and how it compares with the oldest measurement in range, plus the recent runs.
- Rollout guard: the switch cannot be turned on (409 `CHAT_RELAY_MIN_BUILD_NOT_MET`) and the job skips every run until the minimum supported build is **26** (app 1.0.9) or newer. That minimum is the highest build ever published as a **critical** release (recorded monotonically in `app_settings.app_min_supported_build` at publish time and backfilled from release history), capped by the currently published build so a rollback to an older APK re-blocks the purge; a later optional/recommended release does not lower it. Build 26 is the first build whose devices keep chat media locally; older apps would show broken media. **Limitation:** the update flow is manual and the API does not yet reject clients below the minimum, so a published critical release is a release-history signal, not proof every phone upgraded. Before enabling, confirm no active sessions still run builds below 26 (a server-enforced minimum-build gate is the intended follow-up).
- Client behaviour: phones show their local copy or an explicit "no longer available"/"expired" placeholder; Avarpus Web and Expo web show text plus an "open on your phone" note; forwarding a purged message re-uploads the phone's local copy (refused with a clear message when there is none); Drive backup includes media bytes only while the relay copy exists and reports on-device-only counts.
- Lost-copy protection (the `lost` ack): a `stored` receipt is only a claim, so the phone keeps checking it. The download manager (`artifacts/mobile/utils/chatMedia/downloadManager.ts`) verifies an indexed file by exact byte size when its bubble renders (cached 10 min) and sweeps every indexed file whose relay copy still exists after each start/foreground sync (throttled to 15 min). A file found missing or truncated is dropped from the index (the leftover deleted); if the server had been told `stored`, a `lost` ack is queued (`media_lost` table, sent before stored acks on the next sync pass) and `POST /api/chat/acks` with `state: lost` clears that recipient's `stored_at` while `media_state` is still `available` — the one sanctioned reversal of a stored receipt (ignored with reason `relay_gone` once purged/expired, ignored for own messages/text like the other acks; a later `stored` sets `stored_at` afresh). Sender ticks are unaffected. The copy is refetched at once when the auto-download rule allows; otherwise the bubble shows "Not on this phone any more — Save again from server" while the relay still has it (own sent copies and never-acked copies are refetched the same way but never report `lost`). Once the relay copy is gone nothing is offered and the stale index row is left alone so the phone still knows what it once held. The chat-backup screen ("Chat backup" under More) shows "N media files saved on this phone" and "N media files only on this phone" (relay purged/expired/deleted-for-everyone) so users understand what a lost phone means. Probes: `chat-sync` (lost ack semantics, batch precedence, revocation) and mobile Jest (`chat-media`, `chat-store-sqlite-media` against real SQLite, `chat-media-lost-ui`).
- Validation: the `api-vitest` step runs the pure policy tests (`src/lib/chatRelayPolicy.test.ts`), the DB-backed purge tests (`chatRelayCleanup.test.ts`), the receipt retention tests (`chatReceiptRetention.test.ts`) and the run-history tests (`chatRelayHistory.test.ts`: fail-safe recording, bounded window, held measurement) together with every other api-server vitest suite. `admin-chat-relay-browser` (`artifacts/update-admin/scripts/test-chat-relay-browser.mjs`) drives the trend card in a production build against a stubbed API: range folding, uncollected warning, per-day bars, held delta, refresh after Run now, and the non-operator redirect. `chat-relay-purge-e2e` (`artifacts/api-server/scripts/test-chat-relay-purge-e2e.mjs`) drives one real photo through the API against a local Matrix stub — upload → send → recipient `stored` ack → production purge with the switch on and a fixture published critical release at the minimum build — and then checks every reader at once: media endpoint 404 `CHAT_MEDIA_EXPIRED`, messages list and delta sync `mediaState=purged`, operator transcript endpoint, the Avarpus Web chats page placeholder and the update-admin transcript dialog (private production builds, no shared `dist/public`, no production origin). Fixture helpers shared with the other chat scripts live in `artifacts/api-server/scripts/lib/chat-fixtures.mjs`.

## Chat receipt retention

`chat_message_receipts` (one row per recipient per message: delivered/stored acks plus read-implies-delivered backfill) is pruned daily right after the relay purge by `artifacts/api-server/src/lib/chatReceiptRetention.ts`. A receipt is deleted only when its message's relay lifecycle is settled (text / no relay copy, or `media_state` already `purged`/`expired`) **and** either the message is a delete-for-everyone tombstone or the receipt itself is older than **90 days** (code constant `CHAT_RECEIPT_RETENTION_DAYS`, not an operator setting). Receipts on an `available` relay copy — including pinned evidence under an open report — are never touched because the purge counts them. A `lost` ack (phone found its stored copy missing) clears `stored_at` on such a receipt so the purge waits again; it is never applied once the lifecycle is settled. Deletes run oldest-first in batches of 1,000, capped at 50,000 rows per run; the last-run summary is written to `app_settings.chat_receipt_prune_last_run`. After pruning, the sender's delivery summary falls back to the legacy signal (`source: "legacy"`: delivered from the recipient app's last sync, read from `chat_read_state`) and the delta-sync receipts stream simply stops carrying the rows; a late repeat ack is accepted again as a first-seen receipt. Probes: `api-vitest` (`src/lib/chatReceiptRetention.test.ts`, retention rules) and `chat-sync` (sender-view fallback after a prune).

## Object storage sweeps and profile photos

Every environment (development workspace, production deployment, tests) shares **one** object-storage bucket (`PRIVATE_OBJECT_DIR` is a shared secret) but each has its **own** database. Any job that decides "this object is unreferenced, delete it" by reading its own database is therefore only correct where the database owns the bucket. Rules enforced by the API server:

- Storage-deleting schedulers (abandoned Chat/Profile-staging upload sweep, orphaned Status media cleanup, chat relay purge) run only in the Replit production deployment (`REPLIT_DEPLOYMENT=1`) or where `OBJECT_STORAGE_SWEEPS=on` is set explicitly; `OBJECT_STORAGE_SWEEPS=off` disables them anywhere, any other value fails the boot (`src/lib/storageSweeps.ts`). The development workspace logs "Object storage sweeps disabled" at boot. DB-only jobs (auth cleanup, receipt prune, profile-photo row repair) still run everywhere.
- Profile photos are permanent. A user's photo lives at `/objects/uploads/profiles/<userId>/final/<uuid>` (immutable key, new key on every replacement). No sweep may delete a `final/` object; the abandoned-upload sweep counts them as `protected` without evaluating them. Profile photos are separate from chat media: the relay purge and chat media retention never apply to them, and phones cache `final/` photos on disk. Lifecycle of a final object is owned by the request that creates or displaces it (`PATCH /api/auth/me`): a final copied but never attached (claim expired, row update failed) is deleted immediately; the photo a successful replace/remove displaced is deleted only where sweeps are enabled (the row is locked while read and rewritten, so only the exact displaced object is ever removed). Account deletion's object cleanup follows the same gate. Where sweeps are disabled these become harmless orphans rather than a risk to a photo another environment still shows.
- The operator "Run now" relay purge (`POST /api/settings/chat-relay/run`) enforces the gate inside `runChatRelayCleanup` itself and answers 409 `STORAGE_SWEEPS_DISABLED` where sweeps are off; tests that purge their own fixtures pass `storageSweeps: { enabled: true, … }` explicitly.
- The abandoned-upload sweep deletes only objects **this** database registered in `pending_uploads` and never attached (`unregistered` objects are left alone), so an object created by another environment can never be reclaimed here.
- A canonical profile-photo row whose object is definitively missing (`ObjectNotFoundError` only) is cleared at boot/daily by `clearMissingProfilePhotoReferences` so the account falls back to initials and can upload again; any other storage error leaves the row untouched. Tests: `src/lib/pendingUploads.test.ts`, `src/lib/profilePhotoRepair.test.ts`, `src/lib/storageSweeps.test.ts`, `src/routes/pendingUploads.routes.test.ts` (final-photo lifecycle), `src/lib/chatRelayCleanup.test.ts` (gate) — all api-vitest.

## Self-hosting the API (VPS)

`deploy/vps/` holds the runbook (Hindi), systemd unit, nginx config, env template and `deploy.sh` for running the API server on a plain Ubuntu VPS with local PostgreSQL. Two switches make the server portable: `OBJECT_STORAGE_PROVIDER=gcs` + `GCS_SERVICE_ACCOUNT_KEY_FILE` (plain Google Cloud Storage bucket instead of the Replit sidecar) and `RESEND_API_KEY` (direct Resend API instead of the Replit connector). Leave both unset on Replit. `artifacts/api-server/scripts/migrate-objects-to-gcs.mjs` copies the Replit bucket to a GCS bucket and must run on Replit; the VPS service must stay stopped until data and objects are migrated, and `OBJECT_STORAGE_SWEEPS` must stay `off` there until then (see "Object storage sweeps and profile photos").

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

- Every `artifacts/api-server/src/**/*.test.ts` suite runs at task completion through the single `api-vitest` validation step (`cd artifacts/api-server && CI=1 flock /tmp/api-server-tests.lock flock /tmp/heavy-checks.lock npx vitest run`, no file list — `vitest.config.ts` `include` picks up new files automatically, ~80 s for all 28 suites). Do not register per-file or per-domain vitest steps (the former `chat-relay` and `chat-routes` steps were folded in): a file list is exactly how a new suite silently stops running at completion, and a second step re-runs the same suites under the shared tests lock. Keep new suites under `src/` with the `.test.ts` suffix and they are covered; run one file by hand with `npx vitest run <file>` when you want quick feedback.
- **Every test file must be run by a registered validation step, and the `test-registration-guard` step (`node scripts/src/check-test-registration.mjs`, no lock, no database, < 1 s) fails completion when one is not.** It walks every workspace package for `*.test.*` / `*.spec.*` files and `test-*.{js,mjs,ts}` scripts under `scripts/`, `test/`, `tests/`, `e2e/` or `__tests__/`, resolves each `isValidation` workflow in `.replit` through `flock`/`cd`/`sh -c`/pnpm scripts (incl. pre/post hooks and `--filter`) down to its runner, and credits a file only when that runner would actually pick it up: a Vitest catch-all (config `include`, read statically — keep `test.include` a literal string array), a Jest catch-all (`testMatch`, read from the package's jest config), a `node --test` glob, a `node <script>` naming it, or a bare runner script listing the file name in a string literal (update-admin's `run-browser-suites.mjs`). A step chain it cannot follow (missing script, `vitest related`, a Jest preset-supplied `testMatch`) is a failure too. Per-package rules it enforces: api-server `src/**/*.test.ts` → `api-vitest`; api-server `scripts/test-*.mjs` → one `run-isolated.mjs` step each (`customer-khata` and `dealer-detection` had drifted out; the latter's staff expectations were stale); mobile `__tests__/**/*.test.tsx` → `mobile-jest`; avarpus-web is a catch-all too — `test` = `test:scripts` (`node --test "scripts/test-*.mjs"`) + `test:dom` (one `vitest run --config vite.config.ts --environment jsdom --no-file-parallelism`, default include, so any `scripts/*.dom.test.tsx` is picked up) — never re-introduce per-file `test:*` scripts; update-admin browser suites → an entry in `run-browser-suites.mjs`. Test files in a package that has no runner (e.g. `lib/*`) need a catch-all runner script and a step before they count. `--verbose` prints every step's resolved runners and each file's covering step; the failure output names the fix per file.
- **Completion validation budget.** Measured 2026-09-22 on the 4-core / 8 GB task container with all seven dev workflows running: one `startValidationRun` of all 24 registered steps passes in 279 s wall (run `Q7VB-lhUKaO9m0j8zt8B5`, final configuration, dev servers freshly restarted; 257 s on run `MbzyY5E0uZXnc-r9H31aQ` with warm caches; 316 s for the current 27 steps on run `Eo-I3KkugPCePNgMnDQK0` after `customer-khata`, `dealer-detection` and the 3 s `test-registration-guard` were added), peak cgroup anon 3.2 GB against a 1.7 GB idle baseline (`memory.current` peak 4.1 GB), minimum 2.5 GB available, peak load 3.6, at most two heavy node processes alive at once except for a few seconds of one step's own workers; the workspace supervisor grows only ~50 MB per run. The same set still passed in 617 s when the box started with 0 MB available. Run everything in one `startValidationRun`; the old "batch the steps and complete with `skip_validation_reason` citing run IDs" workaround is retired. Rules for adding or changing a step:
  1. Anything that runs `tsc`, `vite build`, a Metro export, Jest, Vitest or Chromium takes `flock /tmp/heavy-checks.lock` (exclusive — one heavy process at a time; each of these peaks 0.6–1.4 GB and the dev servers already hold 2–4 GB). Light node scripts (seconds, < 0.3 GB) run unlocked.
  2. api-server suites keep `flock /tmp/api-server-tests.lock` (fixed ports + shared dev database). A step that needs both locks takes the api lock first, then the heavy lock (`api-vitest`, `chat-relay-purge-e2e`) — never the other order.
  3. Each expensive command runs once per completion: extend an existing chain instead of registering a sibling step — avarpus-web `test` (`test:scripts` + `test:dom`, catch-alls over every `scripts/test-*.mjs` and `*.test.*` file), update-admin `test:browser` (one vite build shared by every browser suite via `scripts/run-browser-suites.mjs`), api `vitest run`, root `typecheck` (`--workspace-concurrency=1`). `workspace-build` runs `pnpm run build:artifacts` (no typecheck prefix) so the mobile `tsc` runs exactly once; the former `typecheck` and `api-typecheck` steps duplicated it and were removed.
  4. Vitest under the harness runs on a pty: prefix with `CI=1` so it does not use its interactive reporter.
  5. Listening ports: the workspace supervisor keeps a few MB for every newly seen listening port until the container is recycled. Use fixed ports (`--strictPort`, `PORT` constants); the api suites get one shared port through the `supertest` alias in `artifacts/api-server/vitest.config.ts` → `src/test-support/supertest.ts` — never import supertest by path or `app.listen(0)` per request. One run of stock supertest (~500 ephemeral ports) cost the supervisor 1.4 GB and it crashed, taking every workflow and the in-flight validation run down.
  6. On a fresh task container every workflow, validation steps included, auto-starts at boot; with the locks that drains in about five minutes. Wait for `ps aux | grep -E "[f]lock /tmp/"` to go quiet before heavy by-hand work, or kill the validation trees by process group (`kill -TERM -- -<pgid>`); never `pkill -f "pnpm run build"` — the api-server dev workflow matches it.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
