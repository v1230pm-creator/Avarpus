import { Router, type IRouter } from "express";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { db, pushTokensTable, sessionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { isValidExpoPushToken, removePushToken } from "../lib/push";
import { PushTokenRegisterBody, PushTokenUnregisterBody } from "@workspace/api-zod";
import { parseBody } from "../lib/validate";

const router: IRouter = Router();

const PLATFORMS = new Set(["ios", "android"]);
// A single account on a handful of devices is normal; hundreds of rows is not.
// Keep the newest registrations and let older ones fall off.
const MAX_TOKENS_PER_USER = 20;
const MAX_DEVICE_INFO_LENGTH = 120;

// ── Register this device for push ───────────────────────────────────────────
// The token is bound to the calling session, so signing out or revoking the
// device from Active Sessions removes it without a separate cleanup path.
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
    const deviceInfo =
      body.deviceInfo?.trim()
        ? body.deviceInfo.trim().slice(0, MAX_DEVICE_INFO_LENGTH)
        : null;

    const [session] = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.token, req.sessionToken!))
      .limit(1);
    if (!session) {
      res.status(401).json({ message: "Session expired. Please sign in again." });
      return;
    }

    const now = new Date();
    // The token is the primary key on purpose: a device signed in to a new
    // account must stop receiving the previous account's alerts.
    await db
      .insert(pushTokensTable)
      .values({
        token,
        userId: me.id,
        sessionId: session.id,
        platform,
        deviceInfo,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: pushTokensTable.token,
        set: { userId: me.id, sessionId: session.id, platform, deviceInfo, updatedAt: now },
      });

    const keep = await db
      .select({ token: pushTokensTable.token })
      .from(pushTokensTable)
      .where(eq(pushTokensTable.userId, me.id))
      .orderBy(desc(pushTokensTable.updatedAt))
      .limit(MAX_TOKENS_PER_USER);
    await db.delete(pushTokensTable).where(
      and(
        eq(pushTokensTable.userId, me.id),
        notInArray(pushTokensTable.token, keep.map((row) => row.token)),
      ),
    );

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

export default router;
