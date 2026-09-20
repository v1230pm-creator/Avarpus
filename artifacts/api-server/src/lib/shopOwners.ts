import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
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
    // Join every membership row for this Shop, whatever its status: the
    // users-row fallback is only for accounts that have *no* membership row
    // at all. A pending or revoked row must not fall through to the mirror.
    .leftJoin(shopMembershipsTable, and(
      eq(shopMembershipsTable.userId, usersTable.id),
      eq(shopMembershipsTable.shopId, shopId),
    ))
    .where(and(
      eq(usersTable.isActive, true),
      or(
        and(eq(shopMembershipsTable.status, "active"), eq(shopMembershipsTable.role, "owner")),
        and(isNull(shopMembershipsTable.id), eq(usersTable.shopId, shopId), inArray(usersTable.role, OWNER_MIRROR_ROLES)),
      ),
      ...(options.excludeUserId ? [ne(usersTable.id, options.excludeUserId)] : []),
    ));
  return rows.map((row) => row.id);
}

/**
 * The subset of `candidateIds` that currently belong to the Shop: an active
 * membership, or (rows that predate memberships) the users mirror pointing at
 * it. Used so a targeted notification never reaches someone who has since
 * been removed from the team, even if a repair still names them.
 */
export async function activeShopMemberIds(
  shopId: string,
  candidateIds: string[],
  options: { executor?: Executor } = {},
): Promise<string[]> {
  const ids = [...new Set(candidateIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const executor = options.executor ?? db;
  const rows = await executor
    .selectDistinct({ id: usersTable.id })
    .from(usersTable)
    .leftJoin(shopMembershipsTable, and(
      eq(shopMembershipsTable.userId, usersTable.id),
      eq(shopMembershipsTable.shopId, shopId),
    ))
    .where(and(
      inArray(usersTable.id, ids),
      eq(usersTable.isActive, true),
      or(
        eq(shopMembershipsTable.status, "active"),
        and(isNull(shopMembershipsTable.id), eq(usersTable.shopId, shopId)),
      ),
    ));
  return rows.map((row: { id: string }) => row.id);
}
