import { Router, type IRouter } from "express";
import { and, eq, ne, or } from "drizzle-orm";
import { db, usersTable, type DbUser } from "@workspace/db";
import { hashPassword, publicUser } from "../lib/authUtils";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { asyncHandler } from "../lib/asyncHandler";
import type { Request } from "express";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Roles a dealer may assign to staff. Dealer/admin/super_admin can NEVER be
// created here — dealers register publicly, super_admins are seeded.
const STAFF_ROLES = ["reception", "technician", "store_manager", "accountant"] as const;

function validPassword(p: unknown): p is string {
  return (
    typeof p === "string" &&
    p.length >= 8 &&
    /[A-Z]/.test(p) &&
    /[a-z]/.test(p) &&
    /[0-9]/.test(p)
  );
}

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
    const { name, email, mobile, password, role, designation } = req.body ?? {};
    if (
      typeof role !== "string" ||
      !(STAFF_ROLES as readonly string[]).includes(role)
    ) {
      res.status(403).json({
        message: "Staff role must be one of: reception, technician, store_manager, accountant",
      });
      return;
    }
    if (
      typeof name !== "string" || !name.trim() ||
      typeof email !== "string" || !EMAIL_RE.test(email.trim()) ||
      typeof mobile !== "string" || !/^\d{10}$/.test(mobile)
    ) {
      res.status(400).json({ message: "Missing or invalid staff details" });
      return;
    }
    if (!validPassword(password)) {
      res.status(400).json({
        message: "Password must be 8+ characters with uppercase, lowercase and a number",
      });
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
      passwordHash: hashPassword(password),
      role,
      shopId: me.shopId,
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

export default router;
