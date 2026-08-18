import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db, roleFeatureSettingsTable, type DbUser } from "@workspace/db";

// ── Per-shop, per-role feature toggles ──────────────────────────────────────
// The shop owner (dealer / super_admin) can switch features on/off for each
// staff role from the app. Stored rows only hold EXPLICIT overrides; anything
// not set falls back to the defaults below, which mirror the app's historical
// role behavior — so shops with no settings behave exactly as before.
//
// Owner roles (dealer, super_admin) are never restricted by these toggles.

export const STAFF_ROLES = ["reception", "technician", "store_manager", "accountant"] as const;
export const PORTAL_ROLES = ["dealer_owner", "dealer_staff"] as const;
export const CONFIGURABLE_ROLES = [...STAFF_ROLES, ...PORTAL_ROLES] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

// Feature keys for internal staff roles.
export const STAFF_FEATURES = [
  "dashboard",
  "repairs",
  "repairs_create",
  "repairs_update",
  "customers",
  "inventory",
  "purchases",
  "finance",
  "payments",
  "reports",
  "approvals",
] as const;

// Feature keys for dealer-portal logins (B2B dealers). The portal is
// read-only by design (enforced fail-closed in requireAuth), so the only
// toggle is whether the portal can be used at all.
export const PORTAL_FEATURES = ["portal_repairs"] as const;

export type FeatureKey = (typeof STAFF_FEATURES)[number] | (typeof PORTAL_FEATURES)[number];

export function featureKeysForRole(role: string): readonly string[] {
  if ((PORTAL_ROLES as readonly string[]).includes(role)) return PORTAL_FEATURES;
  if ((STAFF_ROLES as readonly string[]).includes(role)) return STAFF_FEATURES;
  return [];
}

// Defaults mirror the pre-existing hard-coded role behavior.
export const DEFAULT_ROLE_FEATURES: Record<ConfigurableRole, Record<string, boolean>> = {
  reception: {
    dashboard: true,
    repairs: true,
    repairs_create: true,
    repairs_update: true,
    customers: true,
    inventory: false,
    purchases: false,
    finance: false,
    payments: true,
    reports: false,
    approvals: true,
  },
  technician: {
    dashboard: true,
    repairs: true,
    repairs_create: false,
    repairs_update: true,
    customers: false,
    inventory: false,
    purchases: false,
    finance: false,
    payments: false,
    reports: false,
    approvals: true,
  },
  store_manager: {
    dashboard: true,
    repairs: false,
    repairs_create: false,
    repairs_update: false,
    customers: false,
    inventory: true,
    purchases: true,
    finance: false,
    payments: false,
    reports: false,
    approvals: true,
  },
  accountant: {
    dashboard: true,
    repairs: false,
    repairs_create: false,
    repairs_update: false,
    customers: false,
    inventory: false,
    purchases: true,
    finance: true,
    payments: true,
    reports: true,
    approvals: true,
  },
  dealer_owner: { portal_repairs: true },
  dealer_staff: { portal_repairs: true },
};

// ── Cached per-shop matrix ──────────────────────────────────────────────────
// Feature checks run on hot request paths; a short TTL keeps DB load near zero
// while owner edits still apply within seconds (and instantly on this server
// instance, because updates invalidate the cache).
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; matrix: Record<string, Record<string, boolean>> }>();

export function invalidateRoleFeatureCache(shopId: string) {
  cache.delete(shopId);
}

/** Full effective matrix for a shop: defaults merged with stored overrides. */
export async function getShopRoleFeatureMatrix(
  shopId: string,
): Promise<Record<string, Record<string, boolean>>> {
  const hit = cache.get(shopId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.matrix;

  const rows = await db
    .select()
    .from(roleFeatureSettingsTable)
    .where(eq(roleFeatureSettingsTable.shopId, shopId));

  const matrix: Record<string, Record<string, boolean>> = {};
  for (const role of CONFIGURABLE_ROLES) {
    const stored = rows.find((r) => r.role === role)?.features as
      | Record<string, unknown>
      | undefined;
    const merged: Record<string, boolean> = { ...DEFAULT_ROLE_FEATURES[role] };
    if (stored && typeof stored === "object") {
      for (const key of featureKeysForRole(role)) {
        if (typeof stored[key] === "boolean") merged[key] = stored[key] as boolean;
      }
    }
    matrix[role] = merged;
  }
  cache.set(shopId, { at: Date.now(), matrix });
  return matrix;
}

/** Effective feature map for one user (owner roles get everything). */
export async function effectiveFeaturesForUser(user: DbUser): Promise<Record<string, boolean>> {
  if (user.role === "dealer" || user.role === "super_admin") {
    const all: Record<string, boolean> = {};
    for (const k of [...STAFF_FEATURES, ...PORTAL_FEATURES]) all[k] = true;
    return all;
  }
  if (!user.shopId || !(CONFIGURABLE_ROLES as readonly string[]).includes(user.role)) return {};
  const matrix = await getShopRoleFeatureMatrix(user.shopId);
  return matrix[user.role] ?? {};
}

/** True when `user` may use `feature`. Owner roles always pass. */
export async function userHasFeature(user: DbUser, feature: FeatureKey): Promise<boolean> {
  if (user.role === "dealer" || user.role === "super_admin") return true;
  if (!user.shopId) return false;
  if (!(CONFIGURABLE_ROLES as readonly string[]).includes(user.role)) return false;
  if (!featureKeysForRole(user.role).includes(feature)) return false;
  const matrix = await getShopRoleFeatureMatrix(user.shopId);
  return matrix[user.role]?.[feature] === true;
}

/** Express middleware: 403 FEATURE_DISABLED unless the user has the feature. */
export function requireFeature(feature: FeatureKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user: DbUser }).user;
    userHasFeature(user, feature)
      .then((ok) => {
        if (ok) return next();
        res.status(403).json({
          code: "FEATURE_DISABLED",
          message: "This feature has been turned off for your role. Ask the shop owner to enable it in Staff Permissions.",
        });
      })
      .catch(next);
  };
}
