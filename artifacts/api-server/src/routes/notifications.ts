import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, notificationPreferencesTable, notificationsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { NotificationPreferencesUpdateBody, NotificationsMarkReadBody } from "@workspace/api-zod";
import { parseBody } from "../lib/validate";
import { DEFAULT_PUSH_PREFERENCES, type PushPreferences } from "../lib/push";

const router: IRouter = Router();

// ── My notifications (latest 50) + unread count ─────────────────────────────
router.get(
  "/notifications",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, me.id))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(50);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.userId, me.id), isNull(notificationsTable.readAt)));
    return res.json({
      unreadCount: count,
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        // Legacy rows may hold a double-encoded JSON string; normalize to an object.
        data: (typeof n.data === "string" ? JSON.parse(n.data) : (n.data ?? {})) as Record<string, unknown>,
        read: n.readAt != null,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  }),
);

// ── Mark read: specific ids, or everything when ids is omitted ──────────────
router.post(
  "/notifications/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const body = parseBody(NotificationsMarkReadBody, req, res);
    if (!body) return;
    const ids = (body.ids ?? []).slice(0, 200);
    const conds = [eq(notificationsTable.userId, me.id), isNull(notificationsTable.readAt)];
    if (ids.length > 0) conds.push(inArray(notificationsTable.id, ids));
    await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(and(...conds));
    return res.json({ message: "Marked read" });
  }),
);

// ── Notification preferences ────────────────────────────────────────────────
// Per-account, applied server-side at send time so every device of the account
// behaves the same. No row means the product defaults (everything on).

const PREFERENCE_KEYS = [
  "messages",
  "calls",
  "dealer",
  "repair",
  "payments",
  "status",
  "showPreview",
  "sound",
  "vibration",
] as const satisfies ReadonlyArray<keyof PushPreferences>;

function publicPreferences(row: PushPreferences | undefined): PushPreferences {
  const source = row ?? DEFAULT_PUSH_PREFERENCES;
  const out = {} as PushPreferences;
  for (const key of PREFERENCE_KEYS) out[key] = source[key];
  return out;
}

router.get(
  "/notifications/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const [row] = await db
      .select()
      .from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, me.id))
      .limit(1);
    res.json({ preferences: publicPreferences(row) });
  }),
);

router.put(
  "/notifications/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const body = parseBody(NotificationPreferencesUpdateBody, req, res);
    if (!body) return;
    const patch: Partial<PushPreferences> = {};
    for (const key of PREFERENCE_KEYS) {
      const value = body[key];
      if (typeof value === "boolean") patch[key] = value;
    }
    const now = new Date();
    const [row] = await db
      .insert(notificationPreferencesTable)
      .values({ userId: me.id, ...DEFAULT_PUSH_PREFERENCES, ...patch, updatedAt: now })
      .onConflictDoUpdate({
        target: notificationPreferencesTable.userId,
        set: { ...patch, updatedAt: now },
      })
      .returning();
    res.json({ preferences: publicPreferences(row) });
  }),
);

export default router;
