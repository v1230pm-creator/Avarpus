import { Router, type IRouter } from "express";
import { and, eq, ne, or } from "drizzle-orm";
import {
  db,
  usersTable,
  dealersTable,
  userFeatureSettingsTable,
  type DbUser,
} from "@workspace/db";
import { generateToken, hashPassword, publicUser } from "../lib/authUtils";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { asyncHandler } from "../lib/asyncHandler";
import { sendStaffApprovedEmail, sendStaffRejectedEmail } from "../lib/mailer";
import type { Request } from "express";
import {
  CONFIGURABLE_ROLES,
  effectiveFeaturesForUser,
  featureKeysForRole,
  getUserFeatureOverrides,
  invalidateUserFeatureCache,
  roleFeaturesForUser,
} from "../lib/roleFeatures";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Roles a dealer may assign to staff. Dealer/admin/super_admin can NEVER be
// created here — dealers register publicly, super_admins are seeded.
const STAFF_ROLES = ["reception", "technician", "store_manager", "accountant"] as const;

// Dealer-portal login roles: read-only accounts for external B2B dealers.
// They must be linked to a dealers row (dealerId) at creation time.
const DEALER_PORTAL_ROLES = ["dealer_owner", "dealer_staff"] as const;

const MANAGEABLE_ROLES = [...STAFF_ROLES, ...DEALER_PORTAL_ROLES] as const;

type AuthedRequest = Request & { user: DbUser };

// ── List staff of the caller's shop ───────────────────────────────────────
router.get(
  "/staff",
  requireAuth,
  requireRole("dealer", "super_admin"),
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    // super_admin oversees all shops: without a shop of their own they see
    // every non-super-admin account. Dealers see only their own shop's staff.
    if (!me.shopId) {
      if (me.role === "super_admin") {
        const rows = await db
          .select()
          .from(usersTable)
          .where(and(ne(usersTable.role, "super_admin"), ne(usersTable.id, me.id)));
        res.json({ staff: rows.map(publicUser) });
        return;
      }
      res.json({ staff: [] });
      return;
    }
    const rows = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.shopId, me.shopId), ne(usersTable.id, me.id)));
    res.json({ staff: rows.map(publicUser) });
  }),
);

// ── Create a staff account inside the caller's shop ───────────────────────
router.post(
  "/staff",
  requireAuth,
  requireRole("dealer", "super_admin"),
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    if (!me.shopId) {
      res.status(400).json({
        message: "Staff must belong to a shop. Only dealer accounts (which own a shop) can create staff.",
      });
      return;
    }
    const { name, email, mobile, role, designation, dealerId } = req.body ?? {};
    if (
      typeof role !== "string" ||
      !(MANAGEABLE_ROLES as readonly string[]).includes(role)
    ) {
      res.status(403).json({
        message: "Staff role must be one of: reception, technician, store_manager, accountant, dealer_owner, dealer_staff",
      });
      return;
    }
    // Dealer-portal accounts MUST be tied to a dealer of this shop — that
    // link is what scopes every repair they can see.
    let linkedDealerId: string | null = null;
    if ((DEALER_PORTAL_ROLES as readonly string[]).includes(role)) {
      if (typeof dealerId !== "string" || !dealerId.trim()) {
        res.status(400).json({ message: "Dealer account needs a dealerId (the dealer this login belongs to)" });
        return;
      }
      const [dealer] = await db
        .select({ id: dealersTable.id })
        .from(dealersTable)
        .where(and(eq(dealersTable.id, dealerId.trim()), eq(dealersTable.shopId, me.shopId)));
      if (!dealer) {
        res.status(400).json({ message: "Dealer not found in your shop" });
        return;
      }
      linkedDealerId = dealer.id;
    }
    if (
      typeof name !== "string" || !name.trim() ||
      typeof email !== "string" || !EMAIL_RE.test(email.trim()) ||
      typeof mobile !== "string" || !/^\d{10}$/.test(mobile)
    ) {
      res.status(400).json({ message: "Missing or invalid staff details" });
      return;
    }
    const normEmail = email.trim().toLowerCase();
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(or(eq(usersTable.email, normEmail), eq(usersTable.mobile, mobile)))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ message: "Account with this email or mobile already exists" });
      return;
    }
    const [created] = await db.insert(usersTable).values({
      name: name.trim(),
      email: normEmail,
      mobile,
      // Legacy column retained for existing data compatibility; staff access
      // is always established with the mobile OTP flow.
      passwordHash: hashPassword(generateToken()),
      role,
      shopId: me.shopId,
      dealerId: linkedDealerId,
      isActive: true,
      designation:
        typeof designation === "string" && designation.trim()
          ? designation.trim()
          : null,
      joinDate: new Date().toISOString().split("T")[0],
    }).returning();
    res.json({ user: publicUser(created) });
  }),
);

// ── Shared guard: load a staff user the caller may manage ─────────────────
async function loadManagedStaff(me: DbUser, id: string): Promise<
  { ok: true; target: DbUser } | { ok: false; status: number; message: string }
> {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  const target = rows[0];
  if (!target) return { ok: false, status: 404, message: "Account not found" };
  if (target.id === me.id) {
    return { ok: false, status: 400, message: "You cannot manage your own account here" };
  }
  if (target.role === "super_admin") {
    return { ok: false, status: 403, message: "This account cannot be managed" };
  }
  // Dealers may only manage accounts inside their own shop. super_admin
  // (no shop of their own) oversees all shops.
  if (me.role !== "super_admin" && (!me.shopId || target.shopId !== me.shopId)) {
    return { ok: false, status: 404, message: "Account not found" };
  }
  return { ok: true, target };
}

async function permissionResponse(target: DbUser) {
  const [roleFeatures, overrides, features] = await Promise.all([
    roleFeaturesForUser(target),
    getUserFeatureOverrides(target),
    effectiveFeaturesForUser(target),
  ]);
  return {
    user: publicUser(target),
    availableFeatures: [...featureKeysForRole(target.role)],
    roleFeatures,
    overrides,
    features,
  };
}

// ── Read one person's effective permissions and explicit overrides ─────────
router.get(
  "/staff/:id/permissions",
  requireAuth,
  requireRole("dealer", "super_admin"),
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const check = await loadManagedStaff(me, String(req.params.id));
    if (!check.ok) {
      res.status(check.status).json({ message: check.message });
      return;
    }
    if (
      !check.target.shopId ||
      !(CONFIGURABLE_ROLES as readonly string[]).includes(check.target.role)
    ) {
      res.status(403).json({ message: "Individual permissions are not available for this account." });
      return;
    }
    res.json(await permissionResponse(check.target));
  }),
);

// ── Set/clear one person's feature overrides ───────────────────────────────
router.put(
  "/staff/:id/permissions",
  requireAuth,
  requireRole("dealer", "super_admin"),
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const check = await loadManagedStaff(me, String(req.params.id));
    if (!check.ok) {
      res.status(check.status).json({ message: check.message });
      return;
    }
    const target = check.target;
    if (
      !target.shopId ||
      !(CONFIGURABLE_ROLES as readonly string[]).includes(target.role)
    ) {
      res.status(403).json({ message: "Individual permissions are not available for this account." });
      return;
    }

    const body = (req.body ?? {}) as { features?: Record<string, unknown> };
    if (!body.features || typeof body.features !== "object" || Array.isArray(body.features)) {
      res.status(400).json({ message: "features object is required." });
      return;
    }
    const allowedKeys = featureKeysForRole(target.role);
    for (const [key, value] of Object.entries(body.features)) {
      if (!allowedKeys.includes(key)) {
        res.status(400).json({ message: `Unknown feature: ${key}` });
        return;
      }
      if (value !== null && typeof value !== "boolean") {
        res.status(400).json({ message: `Feature ${key} must be true, false, or null.` });
        return;
      }
    }

    const [next, roleFeatures] = await Promise.all([
      getUserFeatureOverrides(target),
      roleFeaturesForUser(target),
    ]);
    for (const [key, value] of Object.entries(body.features)) {
      if (value === null || value === roleFeatures[key]) delete next[key];
      else next[key] = value as boolean;
    }

    if (Object.keys(next).length === 0) {
      await db
        .delete(userFeatureSettingsTable)
        .where(eq(userFeatureSettingsTable.userId, target.id));
    } else {
      await db
        .insert(userFeatureSettingsTable)
        .values({ userId: target.id, shopId: target.shopId, features: next })
        .onConflictDoUpdate({
          target: userFeatureSettingsTable.userId,
          set: {
            shopId: target.shopId,
            features: next,
            updatedAt: new Date(),
          },
        });
    }
    invalidateUserFeatureCache(target.id);
    res.json(await permissionResponse(target));
  }),
);

// ── Approve a pending staff account ───────────────────────────────────────
router.patch(
  "/staff/:id/activate",
  requireAuth,
  requireRole("dealer", "super_admin"),
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const check = await loadManagedStaff(me, String(req.params.id));
    if (!check.ok) {
      res.status(check.status).json({ message: check.message });
      return;
    }
    if (check.target.isActive) {
      res.json({ user: publicUser(check.target) });
      return;
    }
    const [updated] = await db
      .update(usersTable)
      .set({ isActive: true })
      .where(eq(usersTable.id, check.target.id))
      .returning();
    // Notify the staff member. Email failures must never block the approval.
    sendStaffApprovedEmail(updated.email, updated.name).catch((err) => {
      console.error(
        `[staff] Failed to send approval email to ${updated.email}:`,
        err,
      );
    });
    res.json({ user: publicUser(updated) });
  }),
);

// ── Update a staff member's profile ───────────────────────────────────────
router.patch(
  "/staff/:id",
  requireAuth,
  requireRole("dealer", "super_admin"),
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const check = await loadManagedStaff(me, String(req.params.id));
    if (!check.ok) {
      res.status(check.status).json({ message: check.message });
      return;
    }
    // Dealers may only manage staff/dealer-portal accounts; they can never
    // edit another dealer, and can never promote staff to dealer/super_admin.
    if (!(MANAGEABLE_ROLES as readonly string[]).includes(check.target.role)) {
      res.status(403).json({ message: "This account cannot be edited here" });
      return;
    }
    const { name, mobile, role, designation } = req.body ?? {};
    const set: Partial<{
      name: string;
      mobile: string;
      role: string;
      designation: string | null;
    }> = {};
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        res.status(400).json({ message: "Name cannot be empty" });
        return;
      }
      set.name = name.trim();
    }
    if (mobile !== undefined) {
      if (typeof mobile !== "string" || !/^\d{10}$/.test(mobile)) {
        res.status(400).json({ message: "Mobile must be a 10-digit number" });
        return;
      }
      if (mobile !== check.target.mobile) {
        const clash = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(and(eq(usersTable.mobile, mobile), ne(usersTable.id, check.target.id)))
          .limit(1);
        if (clash.length > 0) {
          res.status(409).json({ message: "Another account already uses this mobile number" });
          return;
        }
      }
      set.mobile = mobile;
    }
    if (role !== undefined) {
      // Role changes stay within the account's own family: staff roles are
      // interchangeable, dealer-portal roles are interchangeable, but an
      // account can never cross between them (the dealer link would be
      // orphaned / missing).
      const targetIsPortal = (DEALER_PORTAL_ROLES as readonly string[]).includes(check.target.role);
      const allowedSet: readonly string[] = targetIsPortal ? DEALER_PORTAL_ROLES : STAFF_ROLES;
      if (typeof role !== "string" || !allowedSet.includes(role)) {
        res.status(403).json({
          message: `Role must be one of: ${allowedSet.join(", ")}`,
        });
        return;
      }
      set.role = role;
    }
    if (designation !== undefined) {
      if (typeof designation !== "string") {
        res.status(400).json({ message: "Invalid designation" });
        return;
      }
      set.designation = designation.trim() || null;
    }
    if (Object.keys(set).length === 0) {
      res.json({ user: publicUser(check.target) });
      return;
    }
    const [updated] = await db
      .update(usersTable)
      .set(set)
      .where(eq(usersTable.id, check.target.id))
      .returning();
    res.json({ user: publicUser(updated) });
  }),
);

// ── Reject (delete) a pending staff account ───────────────────────────────
router.delete(
  "/staff/:id",
  requireAuth,
  requireRole("dealer", "super_admin"),
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const check = await loadManagedStaff(me, String(req.params.id));
    if (!check.ok) {
      res.status(check.status).json({ message: check.message });
      return;
    }
    if (check.target.isActive) {
      res.status(400).json({
        message: "Only pending (inactive) accounts can be rejected",
      });
      return;
    }
    // Capture recipient details, delete first, then notify asynchronously.
    // Email failures are logged but never block (or precede) the rejection.
    const { email: targetEmail, name: targetName } = check.target;
    await db.delete(usersTable).where(eq(usersTable.id, check.target.id));
    sendStaffRejectedEmail(targetEmail, targetName).catch((err) => {
      console.error(
        `[staff] Failed to send rejection email to ${targetEmail}:`,
        err,
      );
    });
    res.json({ message: "Registration rejected and account removed" });
  }),
);

export default router;
