import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import {
  db,
  roleFeatureSettingsTable,
  userFeatureSettingsTable,
  type DbUser,
} from "@workspace/db";

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

// Canonical, API-facing permission vocabulary. Feature keys above remain the
// stored/configurable vocabulary for backwards compatibility; these values are
// derived from the effective feature map and must never be persisted as toggles.
export const CANONICAL_PERMISSIONS = [
  "VIEW_KHATA",
  "EDIT_KHATA",
  "VIEW_REPAIR",
  "EDIT_REPAIR",
  "VIEW_BUSINESS_REPORTS",
  "MANAGE_STAFF",
  "MANAGE_BUSINESS_SETTINGS",
] as const;
export type CanonicalPermission = (typeof CANONICAL_PERMISSIONS)[number];

export const OWNER_ROLES = ["dealer", "super_admin"] as const;
function isOwnerRole(role: string): boolean {
  return (OWNER_ROLES as readonly string[]).includes(role);
}

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
    customers: true,
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
const userCache = new Map<
  string,
  {
    at: number;
    shopId: string;
    role: string;
    overrides: Record<string, boolean>;
  }
>();

export function invalidateRoleFeatureCache(shopId: string) {
  cache.delete(shopId);
}

export function invalidateUserFeatureCache(userId: string) {
  userCache.delete(userId);
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

/** Effective role-level features before person-specific overrides. */
export async function roleFeaturesForUser(user: DbUser): Promise<Record<string, boolean>> {
  if (user.role === "dealer" || user.role === "super_admin") {
    const all: Record<string, boolean> = {};
    for (const k of [...STAFF_FEATURES, ...PORTAL_FEATURES]) all[k] = true;
    return all;
  }
  if (!user.shopId || !(CONFIGURABLE_ROLES as readonly string[]).includes(user.role)) return {};
  const matrix = await getShopRoleFeatureMatrix(user.shopId);
  return { ...(matrix[user.role] ?? {}) };
}

/** Explicit person-level overrides only; missing keys inherit the role value. */
export async function getUserFeatureOverrides(user: DbUser): Promise<Record<string, boolean>> {
  if (
    !user.shopId ||
    !(CONFIGURABLE_ROLES as readonly string[]).includes(user.role)
  ) {
    return {};
  }
  const hit = userCache.get(user.id);
  if (
    hit &&
    hit.shopId === user.shopId &&
    hit.role === user.role &&
    Date.now() - hit.at < CACHE_TTL_MS
  ) {
    return { ...hit.overrides };
  }

  const [row] = await db
    .select({ features: userFeatureSettingsTable.features })
    .from(userFeatureSettingsTable)
    .where(
      and(
        eq(userFeatureSettingsTable.userId, user.id),
        eq(userFeatureSettingsTable.shopId, user.shopId),
      ),
    )
    .limit(1);
  const stored =
    row?.features && typeof row.features === "object" && !Array.isArray(row.features)
      ? (row.features as Record<string, unknown>)
      : {};
  const overrides: Record<string, boolean> = {};
  for (const key of featureKeysForRole(user.role)) {
    if (typeof stored[key] === "boolean") overrides[key] = stored[key];
  }
  userCache.set(user.id, {
    at: Date.now(),
    shopId: user.shopId,
    role: user.role,
    overrides,
  });
  return { ...overrides };
}

/** Effective feature map for one user (owner roles get everything). */
export async function effectiveFeaturesForUser(user: DbUser): Promise<Record<string, boolean>> {
  const roleFeatures = await roleFeaturesForUser(user);
  if (isOwnerRole(user.role)) return roleFeatures;
  const overrides = await getUserFeatureOverrides(user);
  return { ...roleFeatures, ...overrides };
}

/** Canonical permissions derived from the legacy effective feature matrix. */
export function canonicalPermissionsForFeatures(
  role: string,
  features: Record<string, boolean>,
): Record<CanonicalPermission, boolean> {
  if (isOwnerRole(role)) {
    return Object.fromEntries(CANONICAL_PERMISSIONS.map((permission) => [permission, true])) as Record<
      CanonicalPermission,
      boolean
    >;
  }
  // Customer users never acquire business permissions, even if an unrelated
  // feature row were introduced for them in the future.
  if (role === "customer") {
    return Object.fromEntries(CANONICAL_PERMISSIONS.map((permission) => [permission, false])) as Record<
      CanonicalPermission,
      boolean
    >;
  }
  return {
    VIEW_KHATA: features.payments === true,
    EDIT_KHATA: features.payments === true,
    VIEW_REPAIR: features.repairs === true || features.portal_repairs === true,
    EDIT_REPAIR: features.repairs_update === true,
    VIEW_BUSINESS_REPORTS: features.reports === true,
    MANAGE_STAFF: false,
    MANAGE_BUSINESS_SETTINGS: false,
  };
}

export async function effectivePermissionsForUser(
  user: DbUser,
): Promise<Record<CanonicalPermission, boolean>> {
  if (isOwnerRole(user.role) || user.role === "customer") {
    return canonicalPermissionsForFeatures(user.role, {});
  }
  return canonicalPermissionsForFeatures(user.role, await effectiveFeaturesForUser(user));
}

export async function userHasPermission(user: DbUser, permission: CanonicalPermission): Promise<boolean> {
  if (isOwnerRole(user.role)) return true;
  return (await effectivePermissionsForUser(user))[permission];
}

/** True when `user` may use `feature`. Owner roles always pass. */
export async function userHasFeature(user: DbUser, feature: FeatureKey): Promise<boolean> {
  if (user.role === "dealer" || user.role === "super_admin") return true;
  if (!user.shopId) return false;
  if (!(CONFIGURABLE_ROLES as readonly string[]).includes(user.role)) return false;
  if (!featureKeysForRole(user.role).includes(feature)) return false;
  const features = await effectiveFeaturesForUser(user);
  return features[feature] === true;
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
          message: "This feature has been turned off for your account. Ask the shop owner to enable it in Permission Settings.",
        });
      })
      .catch(next);
  };
}

/** Require one of the existing feature keys. Useful where two legacy access
 * paths intentionally exist (for example staff repairs and dealer portal
 * repairs) without turning either into a broader canonical alias. */
export function requireAnyFeature(...features: FeatureKey[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user: DbUser }).user;
    Promise.all(features.map((feature) => userHasFeature(user, feature)))
      .then((allowed) => {
        if (allowed.some(Boolean)) return next();
        res.status(403).json({
          code: "FEATURE_DISABLED",
          message: "This feature has been turned off for your account. Ask the shop owner to enable it in Permission Settings.",
        });
      })
      .catch(next);
  };
}

/** Require a canonical permission. Owner roles always pass. */
export function requirePermission(permission: CanonicalPermission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user: DbUser }).user;
    userHasPermission(user, permission)
      .then((allowed) => {
        if (allowed) return next();
        res.status(403).json({
          code: "PERMISSION_DENIED",
          message: "You do not have permission to access this business data.",
        });
      })
      .catch(next);
  };
}
