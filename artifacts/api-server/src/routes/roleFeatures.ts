import { Router, type IRouter, type Request } from "express";
import { sql } from "drizzle-orm";
import { db, roleFeatureSettingsTable, type DbUser } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import {
  CONFIGURABLE_ROLES,
  DEFAULT_ROLE_FEATURES,
  type ConfigurableRole,
  effectiveFeaturesForUser,
  featureKeysForRole,
  getShopRoleFeatureMatrix,
  invalidateRoleFeatureCache,
} from "../lib/roleFeatures";

// ── Role feature settings ───────────────────────────────────────────────────
// GET  /role-features        — any authed user: own effective features; owners
//                              additionally get the full editable matrix.
// PUT  /role-features/:role  — owner only: update toggles for one role.

const router: IRouter = Router();
type AuthedRequest = Request & { user: DbUser };

const isOwner = (u: DbUser) => u.role === "dealer" || u.role === "super_admin";

router.get(
  "/role-features",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const features = await effectiveFeaturesForUser(me);
    if (isOwner(me) && me.shopId) {
      const matrix = await getShopRoleFeatureMatrix(me.shopId);
      return res.json({ features, matrix });
    }
    return res.json({ features });
  }),
);

router.put(
  "/role-features/:role",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    if (!isOwner(me)) {
      return res.status(403).json({ message: "Only the shop owner can change staff permissions." });
    }
    if (!me.shopId) {
      return res.status(403).json({ message: "Your account is not linked to a shop." });
    }
    const role = String(req.params.role);
    if (!(CONFIGURABLE_ROLES as readonly string[]).includes(role)) {
      return res.status(400).json({ message: "Unknown role." });
    }
    const body = (req.body ?? {}) as { features?: Record<string, unknown> };
    const incoming = body.features;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return res.status(400).json({ message: "features object is required." });
    }
    const allowedKeys = featureKeysForRole(role);
    const clean: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (!allowedKeys.includes(key)) {
        return res.status(400).json({ message: `Unknown feature: ${key}` });
      }
      if (typeof value !== "boolean") {
        return res.status(400).json({ message: `Feature ${key} must be true or false.` });
      }
      clean[key] = value;
    }

    // Merge with any existing overrides so a partial update never drops keys.
    const stored = { ...(DEFAULT_ROLE_FEATURES[role as ConfigurableRole] ?? {}), ...clean };
    await db
      .insert(roleFeatureSettingsTable)
      .values({ shopId: me.shopId, role, features: stored })
      .onConflictDoUpdate({
        target: [roleFeatureSettingsTable.shopId, roleFeatureSettingsTable.role],
        set: { features: sql`${roleFeatureSettingsTable.features} || ${JSON.stringify(clean)}::jsonb`, updatedAt: new Date() },
      });
    invalidateRoleFeatureCache(me.shopId);

    const matrix = await getShopRoleFeatureMatrix(me.shopId);
    return res.json({ matrix });
  }),
);

export default router;
