import { Router, type IRouter } from "express";
import { and, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import { db, notificationsTable, pushTokensTable, sessionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { dispatchPushToUsers, isValidExpoPushToken, removePushToken } from "../lib/push";
import { checkWindowLimit, retryAfterText } from "../lib/rateLimit";
import { PushTokenRegisterBody, PushTokenUnregisterBody } from "@workspace/api-zod";
import { parseBody } from "../lib/validate";

const router: IRouter = Router();

const PLATFORMS = new Set(["ios", "android"]);
// A single account on a handful of devices is normal; hundreds of rows is not.
// Keep the newest registrations and let older ones fall off.
const MAX_TOKENS_PER_USER = 20;
const MAX_DEVICE_INFO_LENGTH = 120;
const MAX_DEVICE_ID_LENGTH = 120;
const MAX_APP_VERSION_LENGTH = 60;
// Test pushes are for the diagnostics screen; a handful per hour is plenty.
const TEST_PUSH_MAX_PER_WINDOW = 5;
const TEST_PUSH_WINDOW_MS = 15 * 60 * 1000;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

async function currentSessionId(sessionToken: string): Promise<string | null> {
  const [session] = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(eq(sessionsTable.token, sessionToken))
    .limit(1);
  return session?.id ?? null;
}

// ── Register this device for push ───────────────────────────────────────────
// The token is bound to the calling session, so signing out or revoking the
// device from Active Sessions removes it without a separate cleanup path.
// Re-registering is the heartbeat: the app calls this on every start, which
// keeps last_seen_at, app_version and notifications_enabled truthful.
router.post(
  "/push/tokens",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const body = parseBody(PushTokenRegisterBody, req, res);
    if (!body) return;
    const token = body.token;
    const platform = typeof body.platform === "string" ? body.platform : "";
    if (!isValidExpoPushToken(token)) {
      res.status(400).json({ message: "A valid device push token is required." });
      return;
    }
    if (!PLATFORMS.has(platform)) {
      res.status(400).json({ message: "platform must be 'ios' or 'android'." });
      return;
    }
    const deviceInfo = clean(body.deviceInfo, MAX_DEVICE_INFO_LENGTH);
    const deviceId = clean(body.deviceId, MAX_DEVICE_ID_LENGTH);
    const appVersion = clean(body.appVersion, MAX_APP_VERSION_LENGTH);
    const notificationsEnabled = body.notificationsEnabled !== false;

    const sessionId = await currentSessionId(req.sessionToken!);
    if (!sessionId) {
      res.status(401).json({ message: "Session expired. Please sign in again." });
      return;
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      // The token is the primary key on purpose: a device signed in to a new
      // account must stop receiving the previous account's alerts.
      await tx
        .insert(pushTokensTable)
        .values({
          token,
          userId: me.id,
          sessionId,
          platform,
          deviceInfo,
          deviceId,
          appVersion,
          notificationsEnabled,
          lastSeenAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: pushTokensTable.token,
          set: {
            userId: me.id,
            sessionId,
            platform,
            // Re-syncs from the foreground watcher omit the descriptive
            // fields; an omitted field keeps its stored value instead of
            // being wiped to null.
            deviceInfo: deviceInfo ?? sql`${pushTokensTable.deviceInfo}`,
            deviceId: deviceId ?? sql`${pushTokensTable.deviceId}`,
            appVersion: appVersion ?? sql`${pushTokensTable.appVersion}`,
            notificationsEnabled,
            lastSeenAt: now,
            updatedAt: now,
          },
        });

      // A device whose token rotated must not keep its old token alive too,
      // or every message reaches the same handset twice.
      if (deviceId) {
        await tx.delete(pushTokensTable).where(
          and(
            eq(pushTokensTable.userId, me.id),
            eq(pushTokensTable.deviceId, deviceId),
            ne(pushTokensTable.token, token),
          ),
        );
      }

      const keep = await tx
        .select({ token: pushTokensTable.token })
        .from(pushTokensTable)
        .where(eq(pushTokensTable.userId, me.id))
        .orderBy(desc(pushTokensTable.updatedAt))
        .limit(MAX_TOKENS_PER_USER);
      await tx.delete(pushTokensTable).where(
        and(
          eq(pushTokensTable.userId, me.id),
          notInArray(pushTokensTable.token, keep.map((row) => row.token)),
        ),
      );
    });

    res.json({ message: "Registered for push" });
  }),
);

// ── Stop push on this device ────────────────────────────────────────────────
// Idempotent: an unknown or already-removed token is a success, so a client
// signing out never has to care whether it registered in the first place.
router.post(
  "/push/tokens/unregister",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const body = parseBody(PushTokenUnregisterBody, req, res);
    if (!body) return;
    const token = body.token;
    if (isValidExpoPushToken(token)) await removePushToken(me.id, token);
    res.json({ message: "Push disabled for this device" });
  }),
);

// ── My registered devices (diagnostics) ─────────────────────────────────────
// Tokens are never returned; the last four characters are enough for a user
// to match the row against the device in their hand.
router.get(
  "/push/devices",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const sessionId = await currentSessionId(req.sessionToken!);
    const rows = await db
      .select()
      .from(pushTokensTable)
      .where(eq(pushTokensTable.userId, me.id))
      .orderBy(desc(pushTokensTable.lastSeenAt));
    res.json({
      devices: rows.map((row) => ({
        tokenSuffix: row.token.replace(/\]$/, "").slice(-4),
        platform: row.platform,
        deviceInfo: row.deviceInfo,
        appVersion: row.appVersion,
        notificationsEnabled: row.notificationsEnabled,
        current: sessionId != null && row.sessionId === sessionId,
        lastSeenAt: row.lastSeenAt.toISOString(),
        lastSentAt: row.lastSentAt ? row.lastSentAt.toISOString() : null,
        lastError: row.lastError,
        lastErrorAt: row.lastErrorAt ? row.lastErrorAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  }),
);

// ── Test notification ───────────────────────────────────────────────────────
// Writes a real inbox row and pushes it like any other alert, so the whole
// pipeline (row → preferences → devices → provider → channel) is exercised.
router.post(
  "/push/test",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const limit = checkWindowLimit(`push-test:${me.id}`, TEST_PUSH_MAX_PER_WINDOW, TEST_PUSH_WINDOW_MS);
    if (limit.limited) {
      res.status(429).json({
        message: `Too many test notifications. Try again in ${retryAfterText(limit.retryAfterMs)}.`,
      });
      return;
    }
    const devices = await db
      .select({ token: pushTokensTable.token })
      .from(pushTokensTable)
      .where(and(eq(pushTokensTable.userId, me.id), eq(pushTokensTable.notificationsEnabled, true)));
    const title = "Avarpus test notification";
    const body = "Push notifications are working on this device.";
    const data = { test: true };
    const inserted = await db
      .insert(notificationsTable)
      .values({ shopId: null, userId: me.id, type: "push_test", title, body, data })
      .returning({ userId: notificationsTable.userId });
    dispatchPushToUsers(inserted.map((row) => row.userId), { type: "push_test", title, body, data });
    res.json({ message: "Test notification sent", deviceCount: devices.length });
  }),
);

export default router;
