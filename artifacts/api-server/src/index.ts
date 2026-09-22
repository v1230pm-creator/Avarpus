import app from "./app";
import { logger } from "./lib/logger";
import { seedUsersIfEmpty } from "./lib/seed";
import { cleanupExpiredAuthData } from "./lib/authUtils";
import { warnIfMailFromUnset } from "./lib/mailer";
import { cleanupAbandonedStatusUploads } from "./routes/status";
import { cleanupAbandonedChatAndProfileUploads } from "./lib/pendingUploads";
import { runChatRelayCleanup } from "./lib/chatRelayCleanup";
import { pruneChatMessageReceipts } from "./lib/chatReceiptRetention";
import {
  clearMissingProfilePhotoReferences,
  repairLeftNoLegacyReferences,
  repairLegacyProfilePhotoPaths,
} from "./lib/profilePhotoRepair";
import { resolveStorageSweepPolicy } from "./lib/storageSweeps";

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

// Resolved once, before listening: a malformed switch must stop the boot,
// not silently pick a default for a job that deletes user data.
const storageSweeps = resolveStorageSweepPolicy();

function runAuthCleanup(): void {
  cleanupExpiredAuthData()
    .then((counts) => {
      logger.info({ counts }, "Auth data cleanup completed");
    })
    .catch((err) => {
      logger.error({ err }, "Auth data cleanup failed");
    });
}

function runStatusUploadCleanup(): void {
  cleanupAbandonedStatusUploads()
    .catch((err) => {
      logger.error({ err }, "Status upload cleanup failed");
    });
}

// Chat media relay purge: drops relay objects every recipient device has
// stored (plus grace) and expires undelivered media past the hard cap. The
// job checks the operator switch and the minimum-build guard on every run.
// The receipt prune follows it (never runs concurrently with it) so receipts
// on media the purge just settled are counted once and then age out; it only
// touches receipts the purge can no longer need, so a skipped or aborted purge
// does not hold it back.
function runChatRelayPurge(): void {
  runChatRelayCleanup()
    .then((result) => {
      if (result.skipped) {
        logger.info({ skipped: result.skipped }, "Chat relay purge skipped");
      }
    })
    .catch((err) => {
      logger.error({ err }, "Chat relay purge failed");
    })
    .then(() => pruneChatMessageReceipts())
    .catch((err) => {
      logger.error({ err }, "Chat receipt prune failed");
    });
}

function runChatAndProfileUploadCleanup(): void {
  cleanupAbandonedChatAndProfileUploads()
    .catch((err) => {
      logger.error({ err }, "Chat/Profile upload cleanup failed");
    });
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function startServer(): void {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    warnIfMailFromUnset();

    seedUsersIfEmpty().catch((err) => {
      logger.error({ err }, "Failed to seed initial users");
    });

    // Prune expired sessions/OTP codes and old login events on boot,
    // then daily. unref() so the timer never blocks process shutdown.
    runAuthCleanup();
    setInterval(runAuthCleanup, CLEANUP_INTERVAL_MS).unref();

    // Rewrite profile photo rows stored with encoded bucket paths to their
    // canonical entity paths, and drop references whose final object no
    // longer exists in storage (only a definitive not-found clears a row).
    // Both steps only touch database rows, never storage, so they run in
    // every environment. When storage sweeps are enabled the reclaim of
    // never-attached Chat/Profile-staging objects follows the legacy repair:
    // the sweep only matches canonical paths, so it must not run while any
    // legacy reference could still be misread as unattached; a failed or
    // partial repair skips this boot's sweep and the daily timer retries.
    const repairThenCleanup = (): void => {
      repairLegacyProfilePhotoPaths()
        .then((result) => {
          if (!storageSweeps.enabled) return;
          if (repairLeftNoLegacyReferences(result)) {
            runChatAndProfileUploadCleanup();
          } else {
            logger.warn({ result }, "Legacy profile photo repair incomplete; skipping Chat/Profile upload cleanup this run");
          }
        })
        .catch((err) => {
          logger.error({ err }, "Legacy profile photo repair failed; skipping Chat/Profile upload cleanup this run");
        })
        .then(() => clearMissingProfilePhotoReferences())
        .catch((err) => {
          logger.error({ err }, "Missing profile photo reference check failed");
        });
    };
    repairThenCleanup();
    setInterval(repairThenCleanup, CLEANUP_INTERVAL_MS).unref();

    // Jobs that DELETE objects from storage run only where this database is
    // the authority for the bucket. Every environment shares the bucket but
    // has its own database, so a sweep elsewhere (e.g. the development
    // workspace) would judge production objects "unreferenced" and delete
    // them — which is how production profile photos went missing.
    if (!storageSweeps.enabled) {
      logger.warn(
        { reason: storageSweeps.reason },
        "Object storage sweeps disabled in this environment (Status cleanup, Chat/Profile upload cleanup, chat relay purge)",
      );
      // The receipt prune only touches this database's own rows for media
      // the relay purge has already settled, so it still runs here.
      const runReceiptPruneOnly = (): void => {
        pruneChatMessageReceipts().catch((err) => {
          logger.error({ err }, "Chat receipt prune failed");
        });
      };
      runReceiptPruneOnly();
      setInterval(runReceiptPruneOnly, CLEANUP_INTERVAL_MS).unref();
      return;
    }
    logger.info({ reason: storageSweeps.reason }, "Object storage sweeps enabled");

    // Remove old, unclaimed Status uploads. The job is prefix-scoped and
    // keeps every object referenced by a published Status.
    runStatusUploadCleanup();
    setInterval(runStatusUploadCleanup, CLEANUP_INTERVAL_MS).unref();

    // Relay purge, then the chat receipt prune that depends on its outcome.
    runChatRelayPurge();
    setInterval(runChatRelayPurge, CLEANUP_INTERVAL_MS).unref();
  });
}

// Development schema changes are applied by the project schema-push flow;
// production schema changes are applied by Replit Publish. Running DDL here
// can replay stale migrations or block deployment startup health checks.
logger.info("Database schema managed externally; skipping runtime migrations");
startServer();
