import { and, eq, inArray, ne, or } from "drizzle-orm";
import { db, shopMembershipsTable, usersTable } from "@workspace/db";

// Legacy compatibility roles: users.role mirrors the *currently selected*
// workspace, so it only identifies an owner while that Shop is active.
const OWNER_MIRROR_ROLES = ["dealer", "super_admin"];

type Executor = Pick<typeof db, "selectDistinct">;

/**
 * Every active user who owns the given Shop. A Shop may have several owners
 * (co-owners joined through an owner invitation), and an owner keeps owning
 * the Shop while another workspace is selected, so ownership is resolved from
 * active `owner` memberships — the users.shopId/role mirror is only a fallback
 * for rows that predate memberships.
 */
export async function shopOwnerUserIds(
  shopId: string,
  options: { excludeUserId?: string | null; executor?: Executor } = {},
): Promise<string[]> {
  const executor = options.executor ?? db;
  const rows = await executor
    .selectDistinct({ id: usersTable.id })
    .from(usersTable)
    .leftJoin(shopMembershipsTable, and(
      eq(shopMembershipsTable.userId, usersTable.id),
      eq(shopMembershipsTable.shopId, shopId),
      eq(shopMembershipsTable.status, "active"),
      eq(shopMembershipsTable.role, "owner"),
    ))
    .where(and(
      eq(usersTable.isActive, true),
      or(
        eq(shopMembershipsTable.role, "owner"),
        and(eq(usersTable.shopId, shopId), inArray(usersTable.role, OWNER_MIRROR_ROLES)),
      ),
      ...(options.excludeUserId ? [ne(usersTable.id, options.excludeUserId)] : []),
    ));
  return rows.map((row) => row.id);
}
