import type { Request } from "express";
import type { DbUser } from "@workspace/db";
import { db, dealersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import contract from "./dealerPortalContract.json";

// ── B2B dealer portal accounts ──────────────────────────────────────────────
// Roles for external dealer logins (NOT the shop-owner `dealer` role).
// These accounts may only READ their own dealer's repair data — everything
// else in the API is blocked, fail-closed, at the auth boundary.
export const DEALER_PORTAL_ROLES = ["dealer_owner", "dealer_staff"] as const;

export function isDealerPortalRole(role: string): boolean {
  return (DEALER_PORTAL_ROLES as readonly string[]).includes(role);
}

// Dealer deactivation is the portal access switch for every account linked to
// that dealer. Existing sessions are intentionally retained: they fail closed
// while inactive and resume after reactivation if they have not expired.
export async function dealerPortalDealerIsActive(user: DbUser): Promise<boolean> {
  if (!isDealerPortalRole(user.role) || !user.shopId || !user.dealerId) return false;
  const [dealer] = await db
    .select({ id: dealersTable.id })
    .from(dealersTable)
    .where(and(
      eq(dealersTable.id, user.dealerId),
      eq(dealersTable.shopId, user.shopId),
      eq(dealersTable.isActive, true),
    ))
    .limit(1);
  return Boolean(dealer);
}

// Allowlist of endpoints a dealer-portal account may call. Anything not
// listed is 403 — new endpoints are therefore blocked by default. Families and
// their inactive-dealer probes live in the same contract consumed by validation.
const ALLOWED = contract.rules.map(({ method, pattern }) => ({
  method,
  re: new RegExp(pattern),
}));

export function dealerPortalAllowed(req: Request): boolean {
  // req.path is relative to the /api mount (e.g. /repairs/…)
  const path = req.path.replace(/\/+$/, "") || "/";
  return ALLOWED.some((a) => a.method === req.method && a.re.test(path));
}

// Families a portal login keeps even when the supplier shop has deactivated
// the dealer row or switched the portal off: account self-service and setting
// up the person's OWN Shop. Neither reads the supplier's data, and the
// supplier must not be able to veto the person's independent business.
const EXEMPT_FAMILIES = new Set(
  contract.families
    .filter((f) => "inactiveDealerExempt" in f && f.inactiveDealerExempt === true)
    .map((f) => f.id),
);
const INACTIVE_EXEMPT = contract.rules
  .filter((r) => EXEMPT_FAMILIES.has(r.family))
  .map(({ method, pattern }) => ({ method, re: new RegExp(pattern) }));

export function dealerPortalInactiveExempt(req: Request): boolean {
  const path = req.path.replace(/\/+$/, "") || "/";
  return INACTIVE_EXEMPT.some((a) => a.method === req.method && a.re.test(path));
}
