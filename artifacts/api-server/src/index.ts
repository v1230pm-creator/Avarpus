import app from "./app";
import { logger } from "./lib/logger";
import { seedUsersIfEmpty } from "./lib/seed";
import { cleanupExpiredAuthData } from "./lib/authUtils";
import { warnIfMailFromUnset } from "./lib/mailer";
import { cleanupAbandonedStatusUploads } from "./routes/status";
import { cleanupAbandonedChatAndProfileUploads } from "./lib/pendingUploads";
import {
  repairLeftNoLegacyReferences,
  repairLegacyProfilePhotoPaths,
} from "./lib/profilePhotoRepair";

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

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

    // Remove old, unclaimed Status uploads. The job is prefix-scoped and
    // keeps every object referenced by a published Status.
    runStatusUploadCleanup();
    setInterval(runStatusUploadCleanup, CLEANUP_INTERVAL_MS).unref();

    // Rewrite profile photo rows stored with encoded bucket paths to their
    // canonical entity paths, then reclaim private Chat/Profile objects that
    // never became a durable message or active profile photo. The sweep only
    // matches canonical paths, so it must not run while any legacy reference
    // could still be misread as unattached; a failed or partial repair skips
    // this boot's sweep and the daily timer retries the pair.
    const repairThenCleanup = (): void => {
      repairLegacyProfilePhotoPaths()
        .then((result) => {
          if (repairLeftNoLegacyReferences(result)) {
            runChatAndProfileUploadCleanup();
          } else {
            logger.warn({ result }, "Legacy profile photo repair incomplete; skipping Chat/Profile upload cleanup this run");
          }
        })
        .catch((err) => {
          logger.error({ err }, "Legacy profile photo repair failed; skipping Chat/Profile upload cleanup this run");
        });
    };
    repairThenCleanup();
    setInterval(repairThenCleanup, CLEANUP_INTERVAL_MS).unref();
  });
}

// Development schema changes are applied by the project schema-push flow;
// production schema changes are applied by Replit Publish. Running DDL here
// can replay stale migrations or block deployment startup health checks.
logger.info("Database schema managed externally; skipping runtime migrations");
startServer();
