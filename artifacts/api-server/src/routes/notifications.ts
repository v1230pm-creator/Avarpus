import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { NotificationsMarkReadBody } from "@workspace/api-zod";
import { parseBody } from "../lib/validate";

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

export default router;
