import { and, eq, inArray, ne } from "drizzle-orm";
import { db, notificationsTable, usersTable } from "@workspace/db";

// Owner roles that get shop-wide notifications.
const OWNER_ROLES = ["dealer", "super_admin"];

export type NotifyInput = {
  shopId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // The user who performed the action — never notified about their own action.
  actorId?: string;
  // Extra recipients besides shop owners (e.g. assigned technician).
  extraUserIds?: string[];
};

// Best-effort, fire-and-forget: notifications must never fail or slow the
// main request. Always call WITHOUT await, or with .catch swallowed.
export async function notifyShop(input: NotifyInput): Promise<void> {
  try {
    const owners = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.shopId, input.shopId),
          eq(usersTable.isActive, true),
          inArray(usersTable.role, OWNER_ROLES),
          ...(input.actorId ? [ne(usersTable.id, input.actorId)] : []),
        ),
      );
    const ids = new Set(owners.map((o) => o.id));
    for (const id of input.extraUserIds ?? []) {
      if (id && id !== input.actorId) ids.add(id);
    }
    if (ids.size === 0) return;
    await db.insert(notificationsTable).values(
      [...ids].map((userId) => ({
        shopId: input.shopId,
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? {},
      })),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("notifyShop failed:", err);
  }
}
