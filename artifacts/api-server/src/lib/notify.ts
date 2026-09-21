import { and, eq } from "drizzle-orm";
import { db, notificationsTable, usersTable } from "@workspace/db";
import { dispatchPushToUsers } from "./push";
import { activeShopMemberIds, shopOwnerUserIds } from "./shopOwners";

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

export type NotifyUserInput = {
  userId: string;
  shopId?: string | null;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  dedupeKey?: string;
  // Recipient-specific push hints (never stored on the row): app badge total
  // and same-thread unread count. See PushContent.
  badge?: number;
  threadUnread?: number;
};

// Best-effort, fire-and-forget: notifications must never fail or slow the
// main request. Always call WITHOUT await, or with .catch swallowed.
export async function notifyShop(input: NotifyInput): Promise<void> {
  try {
    // Every active owner of the Shop (co-owners included), whichever
    // workspace they currently have selected.
    const ids = new Set(await shopOwnerUserIds(input.shopId, { excludeUserId: input.actorId }));
    // Extra recipients (e.g. the technician a repair names) only if they are
    // still on this Shop's team — removed staff must not keep hearing about it.
    const extras = (input.extraUserIds ?? []).filter((id) => id && id !== input.actorId);
    for (const id of await activeShopMemberIds(input.shopId, extras)) ids.add(id);
    if (ids.size === 0) return;
    const inserted = await db
      .insert(notificationsTable)
      .values(
        [...ids].map((userId) => ({
          shopId: input.shopId,
          userId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: input.data ?? {},
        })),
      )
      .returning({ userId: notificationsTable.userId });
    // Push carries the row's own wording — never a second copy written here.
    dispatchPushToUsers(inserted.map((row) => row.userId), {
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("notifyShop failed:", err);
  }
}

// Exact-recipient notification for membership-scoped features such as global
// direct chat. Unlike notifyShop this never fans out to shop owners.
export async function notifyUser(input: NotifyUserInput): Promise<void> {
  try {
    const inserted = await db
      .insert(notificationsTable)
      .values({
        shopId: input.shopId ?? null,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? {},
        dedupeKey: input.dedupeKey,
      })
      .onConflictDoNothing()
      .returning({ userId: notificationsTable.userId });
    // A retry that dedupes away its row must not buzz the device again, so
    // push follows the insert rather than the call.
    dispatchPushToUsers(inserted.map((row) => row.userId), {
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data,
      badge: input.badge,
      threadUnread: input.threadUnread,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("notifyUser failed:", err);
  }
}

export async function notifyActiveSuperAdminsOfPublicRequest(input: {
  requestId: string;
  kind: "support" | "account_deletion";
}): Promise<void> {
  if (process.env.DISABLE_PUBLIC_REQUEST_ALERTS === "true") return;

  try {
    const recipients = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "super_admin"),
          eq(usersTable.isActive, true),
        ),
      );
    if (recipients.length === 0) return;

    const isDeletion = input.kind === "account_deletion";
    const title = isDeletion ? "Account deletion request received" : "Support request received";
    const body = isDeletion
      ? "A new account deletion request needs secure review."
      : "A new support request needs review.";
    const data = {
      publicRequestId: input.requestId,
      kind: input.kind,
      href: `/public-requests/${input.requestId}`,
    };
    const inserted = await db
      .insert(notificationsTable)
      .values(
        recipients.map(({ id: userId }) => ({
          shopId: null,
          userId,
          type: "public_request_received",
          title,
          body,
          data,
          dedupeKey: `public-request:${input.requestId}:${userId}`,
        })),
      )
      .onConflictDoNothing()
      .returning({ userId: notificationsTable.userId });
    dispatchPushToUsers(inserted.map((row) => row.userId), {
      type: "public_request_received",
      title,
      body,
      data,
    });
  } catch (err) {
    // Public intake is already committed before this best-effort alert runs.
    // eslint-disable-next-line no-console
    console.error("notifyActiveSuperAdminsOfPublicRequest failed:", err);
  }
}

// Cross-shop update for a dealer-to-dealer transaction: tells the SENDING
// shop's owner about something the repairing shop did (status, money). No-op
// for ordinary repairs. Best-effort like everything else here.
export async function notifySourceDealer(
  repair: {
    id: string;
    sourceDealerUserId: string | null;
    sourceDealerShopId: string | null;
  },
  input: { type: string; title: string; body: string; dedupeKey?: string },
): Promise<void> {
  if (!repair.sourceDealerUserId) return;
  await notifyUser({
    userId: repair.sourceDealerUserId,
    shopId: repair.sourceDealerShopId,
    type: input.type,
    title: input.title,
    body: input.body,
    data: { repairId: repair.id, dealerTransaction: true },
    dedupeKey: input.dedupeKey,
  });
}
