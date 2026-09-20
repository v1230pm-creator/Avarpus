import { Router, type IRouter } from "express";
import type { Request } from "express";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  db,
  shopMembershipsTable,
  shopsTable,
  usersTable,
  type DbUser,
} from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middlewares/requireAuth";
import { createOtp, consumeOtp, generateToken, publicUser, sha256 } from "../lib/authUtils";
import { sendOtpEmail } from "../lib/mailer";
import { checkWindowLimit, retryAfterText } from "../lib/rateLimit";
import {
  ShopInvitationClaimBody,
  ShopInvitationCreateBody,
  ShopRecoveryCodeRequestBody,
  ShopRecoveryVerificationCreateBody,
  ShopSetupRequestCreateBody,
  ShopSetupVerificationCreateBody,
  ShopWorkspaceSwitchBody,
} from "@workspace/api-zod";
import { parseBody } from "../lib/validate";
import { isDealerPortalRole } from "../lib/dealerPortal";

const router: IRouter = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STAFF_ROLES = ["reception", "technician", "store_manager", "accountant"] as const;
// Roles an owner may invite into the workspace. "owner" adds a co-owner
// (partner, sibling, second proprietor) with the same unrestricted access as
// the account that created the Shop.
const INVITABLE_ROLES = [...STAFF_ROLES, "owner"] as const;
type AuthedRequest = Request & { user: DbUser };

function me(req: Request): DbUser {
  return (req as AuthedRequest).user;
}

// users.role is the legacy compatibility mirror of the active membership; an
// owner membership is represented there as "dealer".
function mirroredUserRole(membershipRole: string): string {
  return membershipRole === "owner" ? "dealer" : membershipRole;
}

// Fields mirrored onto the users row when a membership becomes the active
// workspace (what /shop/setup writes for the creating owner).
// Owner-only fields (GSTIN printed on documents, the "Owner" designation)
// follow the workspace: they are set when an owner membership is selected and
// cleared again when a staff membership is, so a co-owner of Shop A who also
// works at Shop B never issues B's documents with A's GSTIN.
function workspaceMirror(shop: typeof shopsTable.$inferSelect, membershipRole: string) {
  return {
    shopId: shop.id,
    role: mirroredUserRole(membershipRole),
    isActive: true,
    businessName: shop.businessName,
    shopAddress: shop.address,
    ...(membershipRole === "owner"
      ? { gstNumber: shop.gstNumber, designation: "Owner" }
      : { gstNumber: null, designation: sql`case when ${usersTable.designation} = 'Owner' then null else ${usersTable.designation} end` }),
  };
}

function defaultSettings() {
  return {
    currency: "INR",
    timezone: "Asia/Kolkata",
    notifications: { email: true, sms: false },
    workingHours: { open: "10:00", close: "20:00" },
  };
}

async function membershipFor(userId: string, shopId: string) {
  const [row] = await db
    .select()
    .from(shopMembershipsTable)
    .where(and(
      eq(shopMembershipsTable.userId, userId),
      eq(shopMembershipsTable.shopId, shopId),
      eq(shopMembershipsTable.status, "active"),
    ))
    .limit(1);
  return row ?? null;
}

// This endpoint is deliberately separate from /auth/me: changing workspaces
// must never imply that personal chat/status data was deleted or replaced.
router.get("/shop/me", requireAuth, asyncHandler(async (req, res) => {
  const user = me(req);
  const memberships = await db
    .select({ membership: shopMembershipsTable, shop: shopsTable })
    .from(shopMembershipsTable)
    .innerJoin(shopsTable, eq(shopsTable.id, shopMembershipsTable.shopId))
    .where(and(eq(shopMembershipsTable.userId, user.id), eq(shopMembershipsTable.status, "active")));
  const selected = memberships.find(({ shop }) => shop.id === user.shopId) ?? null;
  // "Backup recovery" (a code sent to the verified business email) only makes
  // sense for an owner restoring their own workspace. Staff members who hold
  // an active membership but no selected workspace simply open it via
  // /shop/switch — they never have access to the business mailbox.
  const ownsAWorkspace = memberships.some(({ membership }) => membership.role === "owner");
  res.json({
    activeShopId: selected?.shop.id ?? null,
    backupDetected: !selected && ownsAWorkspace,
    shop: selected ? {
      id: selected.shop.id,
      businessName: selected.shop.businessName,
      address: selected.shop.address,
      businessEmail: selected.shop.businessEmail,
      businessEmailVerified: !!selected.shop.businessEmailVerifiedAt,
      role: selected.membership.role,
      staffId: selected.membership.staffId,
    } : null,
    memberships: memberships.map(({ membership, shop }) => ({
      id: shop.id,
      businessName: shop.businessName,
      role: membership.role,
      staffId: membership.staffId,
    })),
  });
}));

router.post("/shop/recovery/request", requireAuth, asyncHandler(async (req, res) => {
  const user = me(req);
  const body = parseBody(ShopRecoveryCodeRequestBody, req, res);
  if (!body) return;
  const shopId = body.shopId;
  const membership = await membershipFor(user.id, shopId);
  if (!membership) {
    res.status(404).json({ message: "No recoverable business workspace was found." });
    return;
  }
  const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, shopId)).limit(1);
  if (!shop?.businessEmail || !shop.businessEmailVerifiedAt) {
    res.status(409).json({ message: "This workspace has no verified recovery email. Ask the owner to update it." });
    return;
  }
  const cooldown = checkWindowLimit(`otpreq:business-recovery:${user.id}:${shopId}`, 1, 60_000);
  if (cooldown.limited) {
    res.status(429).json({ message: `Please wait ${retryAfterText(cooldown.retryAfterMs)} before requesting another code.` });
    return;
  }
  const code = await createOtp(shop.businessEmail, "business_recovery", { userId: user.id, shopId });
  try {
    await sendOtpEmail(shop.businessEmail, code, "business recovery", {
      avarpus_email_kind: "business_workspace_recovery",
    });
  } catch (error) {
    req.log.error({ err: error }, "Business recovery email delivery failed");
    res.status(502).json({ message: "Could not send the recovery code. Please try again shortly." });
    return;
  }
  const [local, domain] = shop.businessEmail.split("@");
  const maskedEmail = `${local.slice(0, 2)}***@${domain}`;
  res.json({ message: `Recovery code sent to ${maskedEmail}`, maskedEmail });
}));

router.post("/shop/recovery/verify", requireAuth, asyncHandler(async (req, res) => {
  const user = me(req);
  const body = parseBody(ShopRecoveryVerificationCreateBody, req, res);
  if (!body) return;
  const { shopId, email, code } = body;
  const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, shopId)).limit(1);
  if (!shop?.businessEmail || shop.businessEmail !== email.trim().toLowerCase()) {
    res.status(403).json({ message: "Recovery details are invalid." });
    return;
  }
  const result = await consumeOtp(shop.businessEmail, "business_recovery", code);
  if (!result.ok) {
    res.status(401).json({ message: result.error });
    return;
  }
  const payload = result.payload as { userId?: string; shopId?: string };
  const membership = await membershipFor(user.id, shopId);
  if (payload.userId !== user.id || payload.shopId !== shopId || !membership) {
    res.status(403).json({ message: "Recovery details are invalid." });
    return;
  }
  const [updated] = await db.update(usersTable).set(workspaceMirror(shop, membership.role)).where(eq(usersTable.id, user.id)).returning();
  res.json({ message: "Business workspace restored.", user: publicUser(updated), shop: {
    id: shop.id, businessName: shop.businessName, role: membership.role,
  } });
}));

// Start a business-email verification challenge for an existing personal
// account. No shop is created before the code is successfully consumed.
// A dealer-portal login (a B2B dealer whose supplier shop filed their number)
// has `shopId` pointing at the SUPPLIER's shop, not a workspace of their own.
// Such an account may still open its own Shop: afterwards its supplier's
// repairs stay reachable through GET /dealers/suppliers (matched by mobile).
function hasOwnWorkspace(user: { shopId: string | null; role: string }): boolean {
  if (user.role === "dealer" || user.role === "super_admin") return true;
  return Boolean(user.shopId) && !isDealerPortalRole(user.role);
}

router.post("/shop/setup/request", requireAuth, asyncHandler(async (req, res) => {
  const user = me(req);
  if (hasOwnWorkspace(user)) {
    res.status(409).json({ message: "This account already has a business workspace." });
    return;
  }
  const [existingMembership] = await db
    .select({ id: shopMembershipsTable.id })
    .from(shopMembershipsTable)
    .where(and(eq(shopMembershipsTable.userId, user.id), eq(shopMembershipsTable.status, "active")))
    .limit(1);
  if (existingMembership) {
    res.status(409).json({ message: "A business backup already exists for this account. Recover it instead." });
    return;
  }
  const body = parseBody(ShopSetupRequestCreateBody, req, res);
  if (!body) return;
  const { businessName, email, address, gstNumber } = body;
  if (
    typeof businessName !== "string" || businessName.trim().length < 2 ||
    typeof email !== "string" || !EMAIL_RE.test(email.trim()) ||
    typeof address !== "string" || address.trim().length < 3
  ) {
    res.status(400).json({ message: "Business name, valid business email, and address are required." });
    return;
  }
  const normEmail = email.trim().toLowerCase();
  const cooldown = checkWindowLimit(`otpreq:business-setup:${user.id}:${normEmail}`, 1, 60_000);
  if (cooldown.limited) {
    res.status(429).json({
      message: `Please wait ${retryAfterText(cooldown.retryAfterMs)} before requesting another code.`,
    });
    return;
  }
  const code = await createOtp(normEmail, "business_setup", {
    userId: user.id,
    businessName: businessName.trim().slice(0, 160),
    address: address.trim().slice(0, 500),
    gstNumber: typeof gstNumber === "string" && gstNumber.trim() ? gstNumber.trim().slice(0, 15) : null,
  });
  try {
    await sendOtpEmail(normEmail, code, "business workspace", {
      avarpus_email_kind: "business_workspace_verification",
    });
  } catch (error) {
    req.log.error({ err: error }, "Business workspace email delivery failed");
    res.status(502).json({ message: "Could not send the verification email. Please try again shortly." });
    return;
  }
  res.json({ message: `Verification code sent to ${normEmail}`, email: normEmail });
}));

router.post("/shop/setup/verify", requireAuth, asyncHandler(async (req, res) => {
  const user = me(req);
  const body = parseBody(ShopSetupVerificationCreateBody, req, res);
  if (!body) return;
  const { email, code } = body;
  const result = await consumeOtp(email.trim().toLowerCase(), "business_setup", code);
  if (!result.ok) {
    res.status(401).json({ message: result.error });
    return;
  }
  const payload = result.payload as {
    userId?: string; businessName?: string; address?: string; gstNumber?: string | null;
  };
  if (payload.userId !== user.id || !payload.businessName || !payload.address) {
    res.status(401).json({ message: "This verification code is not valid for this account." });
    return;
  }
  const created = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(usersTable).where(eq(usersTable.id, user.id)).for("update");
    if (!locked || hasOwnWorkspace(locked)) {
      throw new Error("ACCOUNT_ALREADY_HAS_WORKSPACE");
    }
    const [shop] = await tx.insert(shopsTable).values({
      dealerId: user.id,
      businessName: payload.businessName!,
      address: payload.address!,
      gstNumber: payload.gstNumber ?? null,
      businessEmail: email.trim().toLowerCase(),
      businessEmailVerifiedAt: new Date(),
      settings: defaultSettings(),
    }).returning();
    await tx.insert(shopMembershipsTable).values({
      shopId: shop.id,
      userId: user.id,
      role: "owner",
      staffId: null,
      status: "active",
    });
    const [updated] = await tx.update(usersTable).set({
      role: "dealer",
      shopId: shop.id,
      // A former portal login is now a shop owner; its supplier link is
      // resolved by mobile from here on, never by this pointer.
      dealerId: null,
      businessName: shop.businessName,
      shopAddress: shop.address,
      gstNumber: shop.gstNumber,
      designation: "Owner",
      isActive: true,
    }).where(eq(usersTable.id, user.id)).returning();
    return { shop, user: updated };
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "ACCOUNT_ALREADY_HAS_WORKSPACE") return null;
    throw error;
  });
  if (!created) {
    res.status(409).json({ message: "This account already has a business workspace." });
    return;
  }
  res.json({
    message: "Business workspace created.",
    shop: {
      id: created.shop.id,
      businessName: created.shop.businessName,
      businessEmail: created.shop.businessEmail,
      businessEmailVerified: true,
      role: "owner",
    },
    user: publicUser(created.user),
  });
}));

// Owners can connect an already-verified personal Avarpus account. The
// one-time code is stored only as a hash and is consumed on claim.
router.post("/shop/invitations", requireAuth, asyncHandler(async (req, res) => {
  const owner = me(req);
  if (!owner.shopId || !["dealer", "super_admin"].includes(owner.role)) {
    res.status(403).json({ message: "Only a shop owner can invite staff." });
    return;
  }
  const ownerMembership = await membershipFor(owner.id, owner.shopId);
  if (!ownerMembership || ownerMembership.role !== "owner") {
    res.status(403).json({ message: "Only an active shop owner can invite staff." });
    return;
  }
  const body = parseBody(ShopInvitationCreateBody, req, res);
  if (!body) return;
  const { mobile, role } = body;
  if (typeof mobile !== "string" || !/^\d{10}$/.test(mobile) ||
      typeof role !== "string" || !(INVITABLE_ROLES as readonly string[]).includes(role)) {
    res.status(400).json({ message: "A 10-digit mobile number and a valid role (staff role or owner) are required." });
    return;
  }
  const [target] = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(eq(usersTable.mobile, mobile)).limit(1);
  if (!target) {
    res.status(404).json({ message: "That person must create a personal Avarpus account with mobile OTP first." });
    return;
  }
  if (target.role === "dealer" || target.role === "super_admin") {
    res.status(403).json({ message: "This number already runs its own Shop (or is a platform administrator) and cannot be invited." });
    return;
  }
  if (target.role === "dealer_owner" || target.role === "dealer_staff") {
    // Portal logins are created and linked by the shop that owns the dealer
    // profile; the app offers them no claim flow, so the invite would hang.
    res.status(403).json({ message: "This number belongs to a dealer-portal login. Manage it from Staff instead of inviting it." });
    return;
  }
  const [existingMembership] = await db.select({ status: shopMembershipsTable.status })
    .from(shopMembershipsTable)
    .where(and(
      eq(shopMembershipsTable.shopId, owner.shopId),
      eq(shopMembershipsTable.userId, target.id),
    ))
    .limit(1);
  if (existingMembership?.status === "active") {
    res.status(409).json({ message: "This account is already active in your Shop." });
    return;
  }
  const staffId = `STF-${generateToken().slice(0, 8).toUpperCase()}`;
  const claimCode = generateToken().slice(0, 10).toUpperCase();
  const inviteExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const [membership] = await db.insert(shopMembershipsTable).values({
    shopId: owner.shopId,
    userId: target.id,
    role,
    staffId,
    status: "pending",
    inviteCodeHash: sha256(claimCode),
    inviteExpiresAt,
  }).onConflictDoUpdate({
    target: [shopMembershipsTable.shopId, shopMembershipsTable.userId],
    set: { role, staffId, status: "pending", inviteCodeHash: sha256(claimCode), inviteExpiresAt, updatedAt: new Date() },
  }).returning();
  res.json({ staffId: membership.staffId, claimCode, status: membership.status });
}));

router.post("/shop/claim", requireAuth, asyncHandler(async (req, res) => {
  const user = me(req);
  const body = parseBody(ShopInvitationClaimBody, req, res);
  if (!body) return;
  const { staffId, claimCode } = body;
  const [membership] = await db.select().from(shopMembershipsTable)
    .where(and(
      eq(shopMembershipsTable.userId, user.id),
      eq(shopMembershipsTable.staffId, staffId),
      gt(shopMembershipsTable.inviteExpiresAt, new Date()),
    ))
    .limit(1);
  if (!membership || !membership.inviteCodeHash || membership.inviteCodeHash !== sha256(claimCode.trim().toUpperCase())) {
    res.status(403).json({ message: "Staff ID or claim code is invalid." });
    return;
  }
  if (membership.status === "active") {
    // Legacy state: an owner "approved" the invitation before the codes were
    // entered. The codes still prove the handshake, so finish the join by
    // selecting the workspace and retiring the one-time code. The retire is
    // a compare-and-set so a concurrent replay of the same codes loses.
    const [retired] = await db.update(shopMembershipsTable).set({
      inviteCodeHash: null, inviteExpiresAt: null, updatedAt: new Date(),
    }).where(and(
      eq(shopMembershipsTable.id, membership.id),
      eq(shopMembershipsTable.status, "active"),
      eq(shopMembershipsTable.inviteCodeHash, sha256(claimCode.trim().toUpperCase())),
      gt(shopMembershipsTable.inviteExpiresAt, new Date()),
    )).returning();
    if (!retired) {
      res.status(409).json({ message: "This staff invitation was already claimed." });
      return;
    }
    const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, membership.shopId)).limit(1);
    const [joined] = await db.update(usersTable).set(workspaceMirror(shop, membership.role)).where(eq(usersTable.id, user.id)).returning();
    res.json({
      message: "You joined the shop workspace.",
      shop: { id: shop.id, businessName: shop.businessName, role: membership.role, staffId: membership.staffId },
      user: publicUser(joined),
    });
    return;
  }
  const [updated] = await db.update(shopMembershipsTable).set({
    status: "active", inviteCodeHash: null, inviteExpiresAt: null, updatedAt: new Date(),
  }).where(and(
    eq(shopMembershipsTable.id, membership.id),
    eq(shopMembershipsTable.status, "pending"),
    eq(shopMembershipsTable.inviteCodeHash, sha256(claimCode.trim().toUpperCase())),
    gt(shopMembershipsTable.inviteExpiresAt, new Date()),
  )).returning();
  if (!updated) {
    res.status(409).json({ message: "This staff invitation was already claimed." });
    return;
  }
  const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, updated.shopId)).limit(1);
  const [joined] = await db.update(usersTable).set(workspaceMirror(shop, updated.role)).where(eq(usersTable.id, user.id)).returning();
  res.json({
    message: "You joined the shop workspace.",
    shop: { id: shop.id, businessName: shop.businessName, role: updated.role, staffId: updated.staffId },
    user: publicUser(joined),
  });
}));

router.post("/shop/switch", requireAuth, asyncHandler(async (req, res) => {
  const user = me(req);
  const body = parseBody(ShopWorkspaceSwitchBody, req, res);
  if (!body) return;
  const shopId = body.shopId;
  const membership = await membershipFor(user.id, shopId);
  if (!membership) {
    res.status(403).json({ message: "You are not an active member of this workspace." });
    return;
  }
  const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, shopId)).limit(1);
  const [updated] = await db.update(usersTable).set(workspaceMirror(shop, membership.role)).where(eq(usersTable.id, user.id)).returning();
  res.json({ shop: { id: shop.id, businessName: shop.businessName, role: membership.role }, user: publicUser(updated) });
}));

export default router;