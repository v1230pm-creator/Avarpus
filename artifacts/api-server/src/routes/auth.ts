import { Router, type IRouter } from "express";
import { and, eq, or } from "drizzle-orm";
import { db, otpCodesTable, shopsTable, usersTable } from "@workspace/db";
import {
  consumeOtp,
  createOtp,
  createSession,
  deleteSession,
  generateToken,
  getLoginHistory,
  hashPassword,
  listActiveSessions,
  recordLoginEvent,
  revokeAllSessions,
  revokeOtherSessions,
  revokeSessionById,
  publicUser,
  sha256,
  verifyPassword,
} from "../lib/authUtils";
import type { Request } from "express";
import { sendOtpEmail } from "../lib/mailer";
import {
  acquireRateLimitLock,
  checkFailureLockout,
  checkWindowLimit,
  clearFailures,
  recordFailure,
  retryAfterText,
} from "../lib/rateLimit";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import {
  msg91SendOtp,
  msg91VerifyOtp,
  msg91RetryOtp,
  normaliseIndianMobile,
} from "../lib/msg91";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Roles a public STAFF registration may request. Dealer/admin/super_admin
// can never be requested here.
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

// Best-effort device description captured at sign-in: prefer the client-sent
// `device` field, fall back to the User-Agent header.
function deviceInfoFrom(req: Request): string | null {
  const device = (req.body ?? {}).device;
  if (typeof device === "string" && device.trim()) {
    return device.trim().slice(0, 120);
  }
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua.trim().slice(0, 120) : null;
}

// ── Email + password login ────────────────────────────────────────────────
router.post("/auth/login", asyncHandler(async (req, res) => {
  const { emailOrMobile, password, rememberMe } = req.body ?? {};
  if (typeof emailOrMobile !== "string" || typeof password !== "string") {
    res.status(400).json({ message: "Email/mobile and password are required" });
    return;
  }
  const identifier = emailOrMobile.trim().toLowerCase();
  // Throttle repeated failures per account identifier and per client IP.
  const accountKey = `login:acct:${identifier}`;
  const ipKey = `login:ip:${req.ip ?? "unknown"}`;
  const lockout = [checkFailureLockout(accountKey), checkFailureLockout(ipKey)]
    .find((s) => s.limited);
  if (lockout) {
    res.status(429).json({
      message: `Too many failed attempts. Try again in ${retryAfterText(lockout.retryAfterMs)}.`,
    });
    return;
  }
  const rows = await db
    .select()
    .from(usersTable)
    .where(
      or(eq(usersTable.email, identifier), eq(usersTable.mobile, emailOrMobile.trim())),
    )
    .limit(1);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.passwordHash)) {
    recordFailure(accountKey);
    recordFailure(ipKey);
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }
  clearFailures(accountKey);
  if (!user.isActive) {
    res.status(403).json({ message: "Account pending admin approval" });
    return;
  }
  const remember = rememberMe === true;
  const deviceInfo = deviceInfoFrom(req);
  const token = await createSession(user.id, remember, deviceInfo);
  await recordLoginEvent(user.id, "password", remember, deviceInfo);
  res.json({ token, user: publicUser(user) });
}));

// ── Mobile OTP login ──────────────────────────────────────────────────────
router.post("/auth/otp/request", asyncHandler(async (req, res) => {
  const { mobile: rawMobile } = req.body ?? {};
  if (typeof rawMobile !== "string") {
    res.status(400).json({ message: "A valid Indian mobile number is required" });
    return;
  }
  // Accept 10-digit local, +91XXXXXXXXXX, or 91XXXXXXXXXX; normalise to 10-digit.
  const mobile = normaliseIndianMobile(rawMobile);
  if (!mobile) {
    res.status(400).json({ message: "A valid Indian mobile number is required" });
    return;
  }
  // Throttle OTP requests per mobile number and per IP to prevent SMS flooding.
  const perMobile = checkWindowLimit(`otpreq:mobile:${mobile}`, 3, 15 * 60 * 1000);
  const perIp = checkWindowLimit(`otpreq:ip:${req.ip ?? "unknown"}`, 10, 15 * 60 * 1000);
  const throttled = [perMobile, perIp].find((s) => s.limited);
  if (throttled) {
    res.status(429).json({
      message: `Too many code requests. Try again in ${retryAfterText(throttled.retryAfterMs)}.`,
    });
    return;
  }
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.mobile, mobile))
    .limit(1);
  const user = rows[0];
  // Generic response — identical for known/unknown/inactive mobiles to prevent
  // account enumeration.
  const genericMessage = "If this mobile number is registered, a verification code has been sent.";
  res.json({ message: genericMessage });
  if (user?.isActive) {
    void msg91SendOtp(mobile)
      .then((result) => {
        if (!result.ok) req.log.warn("MSG91 OTP send failed");
      })
      .catch(() => req.log.error("Unexpected error calling MSG91 send"));
  }
}));

// ── Mobile OTP resend ─────────────────────────────────────────────────────
router.post("/auth/otp/resend", asyncHandler(async (req, res) => {
  const { mobile: rawMobile } = req.body ?? {};
  if (typeof rawMobile !== "string") {
    res.status(400).json({ message: "A valid Indian mobile number is required" });
    return;
  }
  const mobile = normaliseIndianMobile(rawMobile);
  if (!mobile) {
    res.status(400).json({ message: "A valid Indian mobile number is required" });
    return;
  }
  // Stricter throttle for resend: 2 resends per 15-minute window per mobile.
  const perMobile = checkWindowLimit(`otpresend:mobile:${mobile}`, 2, 15 * 60 * 1000);
  const perIp = checkWindowLimit(`otpresend:ip:${req.ip ?? "unknown"}`, 5, 15 * 60 * 1000);
  const throttled = [perMobile, perIp].find((s) => s.limited);
  if (throttled) {
    res.status(429).json({
      message: `Too many resend requests. Try again in ${retryAfterText(throttled.retryAfterMs)}.`,
    });
    return;
  }
  const genericMessage = "If this mobile number is registered, a new code has been sent.";
  // Only call retry for existing active users; same generic response regardless.
  const rows = await db
    .select({ isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.mobile, mobile))
    .limit(1);
  res.json({ message: genericMessage });
  if (rows[0]?.isActive) {
    void msg91RetryOtp(mobile)
      .then((result) => {
        if (!result.ok) req.log.warn("MSG91 OTP retry failed");
      })
      .catch(() => req.log.error("Unexpected error calling MSG91 retry"));
  }
}));

router.post("/auth/otp/verify", asyncHandler(async (req, res) => {
  const { mobile: rawMobile, code, rememberMe } = req.body ?? {};
  if (typeof rawMobile !== "string" || typeof code !== "string") {
    res.status(400).json({ message: "Mobile and code are required" });
    return;
  }
  // Accept 10-digit, +91 or 91-prefixed; normalise to local 10-digit for DB lookup.
  const mobile = normaliseIndianMobile(rawMobile);
  if (!mobile) {
    res.status(400).json({ message: "A valid Indian mobile number is required" });
    return;
  }

  const attemptKey = `otpverify:${mobile}`;
  // Serialize the lockout check, provider verification, and failure update for
  // this mobile so concurrent guesses cannot bypass the server-side lockout.
  const releaseLock = await acquireRateLimitLock(attemptKey);
  try {
    // Server-side attempt lockout to guard against brute-force on verify endpoint.
    const lockout = checkFailureLockout(attemptKey);
    if (lockout.limited) {
      res.status(429).json({
        message: `Too many incorrect attempts. Try again in ${retryAfterText(lockout.retryAfterMs)}.`,
      });
      return;
    }

    // Verify with MSG91 — this is the authoritative check; no local OTP codes stored.
    let providerResult;
    try {
      providerResult = await msg91VerifyOtp(mobile, code);
    } catch {
      req.log.error("Unexpected error calling MSG91 verify");
      recordFailure(attemptKey);
      res.status(401).json({ message: "Incorrect or expired code. Please try again." });
      return;
    }
    if (!providerResult.ok) {
      recordFailure(attemptKey);
      // Use a generic message to avoid leaking whether provider rejected the code
      // specifically vs. other failure modes.
      res.status(401).json({ message: "Incorrect or expired code. Please try again." });
      return;
    }

    // Code approved by provider — clear failure counter then look up the user.
    clearFailures(attemptKey);

    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.mobile, mobile))
      .limit(1);
    const user = rows[0];
    if (!user || !user.isActive) {
      // Provider approved the code but the account is not eligible (unknown or inactive).
      res.status(401).json({ message: "Account not found or inactive" });
      return;
    }
    const remember = rememberMe === true;
    const deviceInfo = deviceInfoFrom(req);
    const token = await createSession(user.id, remember, deviceInfo);
    await recordLoginEvent(user.id, "otp", remember, deviceInfo);
    res.json({ token, user: publicUser(user) });
  } finally {
    releaseLock();
  }
}));

// ── Registration (email OTP verification) ────────────────────────────────
// Public registration creates DEALER (shop owner) accounts ONLY. Staff,
// admin and super-admin accounts can never be created publicly — staff are
// created by an authenticated dealer via the /staff endpoints.
router.post("/auth/register/start", asyncHandler(async (req, res) => {
  const {
    name,
    businessName,
    email,
    mobile,
    password,
    gstNumber,
    shopAddress,
    role,
    dealerMobile,
  } = req.body ?? {};
  // Public registration creates either a DEALER (shop owner) account, or a
  // STAFF account that joins an existing dealer's shop in a PENDING
  // (isActive: false) state until the dealer/super_admin approves it.
  // Admin/super_admin roles can never be requested here.
  const isStaffRegistration =
    typeof role === "string" && (STAFF_ROLES as readonly string[]).includes(role);
  if (role !== undefined && role !== "dealer" && !isStaffRegistration) {
    res.status(403).json({
      message: "Registration is limited to dealer or staff roles (reception, technician, store manager, accountant).",
    });
    return;
  }
  if (
    typeof name !== "string" || !name.trim() ||
    typeof email !== "string" || !EMAIL_RE.test(email.trim()) ||
    typeof mobile !== "string" || !/^\d{10}$/.test(mobile)
  ) {
    res.status(400).json({ message: "Missing or invalid registration details" });
    return;
  }
  if (!isStaffRegistration && (
    typeof businessName !== "string" || !businessName.trim() ||
    typeof shopAddress !== "string" || !shopAddress.trim()
  )) {
    res.status(400).json({ message: "Missing or invalid registration details" });
    return;
  }
  if (!validPassword(password)) {
    res.status(400).json({
      message: "Password must be 8+ characters with uppercase, lowercase and a number",
    });
    return;
  }
  if (typeof gstNumber === "string" && gstNumber.trim() && gstNumber.trim().length !== 15) {
    res.status(400).json({ message: "GST number must be 15 characters" });
    return;
  }
  // Staff must identify the shop they are joining by the owner's registered mobile.
  let staffShopId: string | null = null;
  if (isStaffRegistration) {
    if (typeof dealerMobile !== "string" || !/^\d{10}$/.test(dealerMobile)) {
      res.status(400).json({ message: "Enter your shop owner's 10-digit registered mobile number" });
      return;
    }
    const dealers = await db
      .select({ shopId: usersTable.shopId })
      .from(usersTable)
      .where(and(eq(usersTable.mobile, dealerMobile), eq(usersTable.role, "dealer")))
      .limit(1);
    if (!dealers[0]?.shopId) {
      res.status(404).json({ message: "No shop found for that owner mobile number. Check with your shop owner." });
      return;
    }
    staffShopId = dealers[0].shopId;
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
  // 60-second cooldown per email between OTP sends (covers resend too)
  const cooldown = checkWindowLimit(`otpreq:register:${normEmail}`, 1, 60 * 1000);
  if (cooldown.limited) {
    res.status(429).json({
      message: `Please wait ${retryAfterText(cooldown.retryAfterMs)} before requesting another code.`,
    });
    return;
  }
  const code = await createOtp(normEmail, "register", {
    kind: isStaffRegistration ? "staff" : "dealer",
    name: name.trim(),
    businessName: isStaffRegistration ? null : (businessName as string).trim(),
    email: normEmail,
    mobile,
    passwordHash: hashPassword(password),
    gstNumber: typeof gstNumber === "string" && gstNumber.trim() ? gstNumber.trim() : null,
    shopAddress: isStaffRegistration ? null : (shopAddress as string).trim(),
    role: isStaffRegistration ? (role as string) : "dealer",
    shopId: staffShopId,
  });
  try {
    await sendOtpEmail(normEmail, code, "registration");
  } catch (err) {
    // Surface the exact Resend error in server logs
    console.error(
      "Registration OTP email delivery failed:",
      err instanceof Error ? err.message : err,
    );
    res.status(502).json({
      message: "Could not send the verification email. Please try again shortly.",
    });
    return;
  }
  res.json({ message: `Verification code sent to ${normEmail}` });
}));

router.post("/auth/register/verify", asyncHandler(async (req, res) => {
  const { email, code } = req.body ?? {};
  if (typeof email !== "string" || typeof code !== "string") {
    res.status(400).json({ message: "Email and code are required" });
    return;
  }
  const normEmail = email.trim().toLowerCase();
  const result = await consumeOtp(normEmail, "register", code);
  if (!result.ok) {
    res.status(401).json({ message: result.error });
    return;
  }
  const p = result.payload as {
    kind?: "dealer" | "staff";
    name: string;
    businessName: string | null;
    email: string;
    mobile: string;
    passwordHash: string;
    gstNumber: string | null;
    shopAddress: string | null;
    role?: string;
    shopId?: string | null;
  };
  // Re-check uniqueness right before insert
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(or(eq(usersTable.email, p.email), eq(usersTable.mobile, p.mobile)))
    .limit(1);
  if (existing.length > 0) {
    res.status(409).json({ message: "Account with this email or mobile already exists" });
    return;
  }
  // ── Staff path: create a PENDING account in the dealer's shop ──────────
  // The account stays isActive: false (cannot sign in) until the dealer or
  // super_admin approves it from the Staff screen. No session is issued.
  if (p.kind === "staff") {
    const role = typeof p.role === "string" && (STAFF_ROLES as readonly string[]).includes(p.role)
      ? p.role
      : null;
    if (!role || !p.shopId) {
      res.status(400).json({ message: "Invalid staff registration request" });
      return;
    }
    // Ensure the shop still exists (dealer could have been removed meanwhile)
    const shops = await db
      .select({ id: shopsTable.id })
      .from(shopsTable)
      .where(eq(shopsTable.id, p.shopId))
      .limit(1);
    if (shops.length === 0) {
      res.status(404).json({ message: "The shop you tried to join no longer exists" });
      return;
    }
    const [created] = await db.insert(usersTable).values({
      name: p.name,
      email: p.email,
      mobile: p.mobile,
      passwordHash: p.passwordHash,
      role,
      shopId: p.shopId,
      isActive: false, // pending approval by dealer/super_admin
      joinDate: new Date().toISOString().split("T")[0],
    }).returning();
    res.json({
      pending: true,
      message: "Registration submitted. Your account is pending approval by your shop owner.",
      user: publicUser(created),
    });
    return;
  }
  // Role is ALWAYS dealer for public registration — never taken from input.
  // User + shop provisioning happen in ONE transaction so a partial failure
  // can never leave an active dealer without a shop/workspace.
  const updated = await db.transaction(async (tx) => {
    const [created] = await tx.insert(usersTable).values({
      name: p.name,
      email: p.email,
      mobile: p.mobile,
      passwordHash: p.passwordHash,
      role: "dealer",
      isActive: true, // dealers are active immediately (email is verified)
      designation: "Owner",
      joinDate: new Date().toISOString().split("T")[0],
      businessName: p.businessName ?? "",
      gstNumber: p.gstNumber,
      shopAddress: p.shopAddress ?? "",
    }).returning();
    // Auto-provision the dealer's shop (default workspace + default settings)
    const [shop] = await tx.insert(shopsTable).values({
      dealerId: created.id,
      businessName: p.businessName ?? "",
      gstNumber: p.gstNumber,
      address: p.shopAddress ?? "",
      settings: {
        currency: "INR",
        timezone: "Asia/Kolkata",
        notifications: { email: true, sms: false },
        workingHours: { open: "10:00", close: "20:00" },
      },
    }).returning();
    const [u] = await tx
      .update(usersTable)
      .set({ shopId: shop.id })
      .where(eq(usersTable.id, created.id))
      .returning();
    return u;
  });
  // Sign the dealer in immediately so the app can land on the dashboard.
  const deviceInfo = deviceInfoFrom(req);
  const token = await createSession(updated.id, false, deviceInfo);
  await recordLoginEvent(updated.id, "password", false, deviceInfo);
  res.json({ token, user: publicUser(updated) });
}));

// ── Forgot password ───────────────────────────────────────────────────────
router.post("/auth/forgot/request", asyncHandler(async (req, res) => {
  const { email } = req.body ?? {};
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    res.status(400).json({ message: "A valid email address is required" });
    return;
  }
  const normEmail = email.trim().toLowerCase();
  const genericMessage =
    "If an account exists with this email, a verification code has been sent.";
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normEmail))
    .limit(1);
  if (rows.length === 0) {
    res.json({ message: genericMessage });
    return;
  }
  try {
    const code = await createOtp(normEmail, "reset", null);
    await sendOtpEmail(normEmail, code, "password reset");
  } catch (err) {
    console.error("Forgot-password email delivery failed:", err instanceof Error ? err.message : err);
  }
  res.json({ message: genericMessage });
}));

router.post("/auth/forgot/verify", asyncHandler(async (req, res) => {
  const { email, code } = req.body ?? {};
  if (typeof email !== "string" || typeof code !== "string") {
    res.status(400).json({ message: "Email and code are required" });
    return;
  }
  const normEmail = email.trim().toLowerCase();
  const result = await consumeOtp(normEmail, "reset", code);
  if (!result.ok) {
    res.status(401).json({ message: result.error });
    return;
  }
  // Issue a short-lived reset token bound to the email
  const resetToken = generateToken();
  await createOtpToken(normEmail, resetToken);
  res.json({ resetToken });
}));

async function createOtpToken(email: string, token: string): Promise<void> {
  await db.insert(otpCodesTable).values({
    identifier: email,
    purpose: "reset_token",
    codeHash: sha256(token),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });
}

router.post("/auth/forgot/reset", asyncHandler(async (req, res) => {
  const { email, resetToken, newPassword } = req.body ?? {};
  if (
    typeof email !== "string" ||
    typeof resetToken !== "string" ||
    typeof newPassword !== "string"
  ) {
    res.status(400).json({ message: "Email, reset token and new password are required" });
    return;
  }
  if (!validPassword(newPassword)) {
    res.status(400).json({
      message: "Password must be 8+ characters with uppercase, lowercase and a number",
    });
    return;
  }
  const normEmail = email.trim().toLowerCase();
  const result = await consumeOtp(normEmail, "reset_token", resetToken);
  if (!result.ok) {
    res.status(401).json({ message: "Reset session expired. Start over." });
    return;
  }
  const updated = await db
    .update(usersTable)
    .set({ passwordHash: hashPassword(newPassword) })
    .where(eq(usersTable.email, normEmail))
    .returning({ id: usersTable.id });
  // Revoke every existing session so a stolen session can't outlive the reset.
  if (updated[0]) await revokeAllSessions(updated[0].id);
  res.json({ message: "Password updated. Sign in with your new password." });
}));

// ── Session ───────────────────────────────────────────────────────────────
router.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

// ── Self profile update (name / mobile) ──────────────────────────────────
router.patch("/auth/me", requireAuth, asyncHandler(async (req, res) => {
  const me = req.user!;
  const { name, mobile } = req.body ?? {};
  const set: Partial<{ name: string; mobile: string }> = {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ message: "Name cannot be empty" });
      return;
    }
    set.name = name.trim().slice(0, 120);
  }
  if (mobile !== undefined) {
    if (typeof mobile !== "string" || !/^\d{10}$/.test(mobile)) {
      res.status(400).json({ message: "Mobile must be a 10-digit number" });
      return;
    }
    if (mobile !== me.mobile) {
      const clash = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.mobile, mobile))
        .limit(1);
      if (clash.length > 0 && clash[0].id !== me.id) {
        res.status(409).json({ message: "Another account already uses this mobile number" });
        return;
      }
    }
    set.mobile = mobile;
  }
  if (Object.keys(set).length === 0) {
    res.json({ user: publicUser(me) });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set(set)
    .where(eq(usersTable.id, me.id))
    .returning();
  res.json({ user: publicUser(updated) });
}));

// ── Self-service password change (current password required) ─────────────
router.post("/auth/change-password", requireAuth, asyncHandler(async (req, res) => {
  const me = req.user!;
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    res.status(400).json({ message: "Current and new password are required" });
    return;
  }
  const lock = checkFailureLockout(`chpw:${me.id}`);
  if (lock.limited) {
    res.status(429).json({ message: `Too many attempts. Try again in ${retryAfterText(lock.retryAfterMs)}.` });
    return;
  }
  if (!me.passwordHash || !verifyPassword(currentPassword, me.passwordHash)) {
    await recordFailure(`chpw:${me.id}`);
    res.status(401).json({ message: "Current password is incorrect" });
    return;
  }
  if (!validPassword(newPassword)) {
    res.status(400).json({
      message: "Password must be 8+ characters with uppercase, lowercase and a number",
    });
    return;
  }
  await clearFailures(`chpw:${me.id}`);
  await db
    .update(usersTable)
    .set({ passwordHash: hashPassword(newPassword) })
    .where(eq(usersTable.id, me.id));
  // Sign out every OTHER device — a stolen session must not survive the
  // change; the device that changed the password stays signed in.
  await revokeOtherSessions(me.id, req.sessionToken!);
  res.json({ message: "Password changed. Other devices have been signed out." });
}));

router.get("/auth/login-history", requireAuth, asyncHandler(async (req, res) => {
  const events = await getLoginHistory(req.user!.id);
  res.json({
    events: events.map((e) => ({
      id: e.id,
      method: e.method,
      rememberMe: e.rememberMe,
      deviceInfo: e.deviceInfo ?? undefined,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}));

// ── Active sessions ───────────────────────────────────────────────────────
router.get("/auth/sessions", requireAuth, asyncHandler(async (req, res) => {
  const sessions = await listActiveSessions(req.user!.id, req.sessionToken!);
  res.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      deviceInfo: s.deviceInfo ?? undefined,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.current,
    })),
  });
}));

router.delete("/auth/sessions/:id", requireAuth, asyncHandler(async (req, res) => {
  const sessionId = String(req.params.id ?? "");
  // Guard against invalid UUIDs, which would make the DB comparison throw
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    res.status(404).json({ message: "Session not found" });
    return;
  }
  const revoked = await revokeSessionById(req.user!.id, sessionId);
  if (!revoked) {
    res.status(404).json({ message: "Session not found" });
    return;
  }
  res.json({ message: "Session signed out" });
}));

router.post("/auth/sessions/revoke-others", requireAuth, asyncHandler(async (req, res) => {
  const count = await revokeOtherSessions(req.user!.id, req.sessionToken!);
  res.json({ message: count === 1 ? "Signed out 1 other device" : `Signed out ${count} other devices` });
}));

router.post("/auth/logout", requireAuth, asyncHandler(async (req, res) => {
  await deleteSession(req.sessionToken!);
  res.json({ message: "Signed out" });
}));

export default router;
