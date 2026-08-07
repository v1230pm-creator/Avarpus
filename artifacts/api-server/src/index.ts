import path from "path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import app from "./app";
import { db } from "@workspace/db";
import { logger } from "./lib/logger";
import { seedUsersIfEmpty } from "./lib/seed";
import { cleanupExpiredAuthData } from "./lib/authUtils";

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

// Run DB migrations (idempotent) then start the server.
// __dirname is set to the dist/ folder by the esbuild banner, so migrations
// are available at dist/migrations/ after the build copies them.
const migrationsFolder = path.resolve(__dirname, "migrations");

migrate(db, { migrationsFolder })
  .then(() => {
    logger.info("Database migrations applied");

    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");

      seedUsersIfEmpty().catch((err) => {
        logger.error({ err }, "Failed to seed initial users");
      });

      // Prune expired sessions/OTP codes and old login events on boot,
      // then daily. unref() so the timer never blocks process shutdown.
      runAuthCleanup();
      setInterval(runAuthCleanup, CLEANUP_INTERVAL_MS).unref();
    });
  })
  .catch((err) => {
    logger.error({ err }, "Database migration failed — server will not start");
    process.exit(1);
  });
