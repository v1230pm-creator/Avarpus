import { Router, type IRouter } from "express";
import { and, eq, ne, or } from "drizzle-orm";
import { db, usersTable, type DbUser } from "@workspace/db";
import { hashPassword, publicUser } from "../lib/authUtils";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { asyncHandler } from "../lib/asyncHandler";
import { sendStaffApprovedEmail, sendStaffRejectedEmail } from "../lib/mailer";
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
    // Dealers may only manage staff-role accounts; they can never edit
    // another dealer, and can never promote staff to dealer/super_admin.
    if (!(STAFF_ROLES as readonly string[]).includes(check.target.role)) {
      res.status(403).json({ message: "This account cannot be edited here" });
      return;
    }
    const { name, mobile, role, designation, password } = req.body ?? {};
    const set: Partial<{
      name: string;
      mobile: string;
      role: string;
      designation: string | null;
      passwordHash: string;
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
      if (typeof role !== "string" || !(STAFF_ROLES as readonly string[]).includes(role)) {
        res.status(403).json({
          message: "Staff role must be one of: reception, technician, store_manager, accountant",
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
    if (password !== undefined && password !== "") {
      if (!validPassword(password)) {
        res.status(400).json({
          message: "Password must be 8+ characters with uppercase, lowercase and a number",
        });
        return;
      }
      set.passwordHash = hashPassword(password);
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
