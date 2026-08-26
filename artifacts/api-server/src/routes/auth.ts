import { Router, type IRouter } from "express";
import { and, eq, or } from "drizzle-orm";
import { db, shopsTable, usersTable } from "@workspace/db";
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
  revokeOtherSessions,
  revokeSessionById,
  publicUser,
} from "../lib/authUtils";
import type { Request } from "express";
import { sendOtpEmail } from "../lib/mailer";
import {
  checkFailureLockout,
  checkWindowLimit,
  clearFailures,
  recordFailure,
  retryAfterText,
  verifyOtpWithDurableLimit,
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
  const attempt = await verifyOtpWithDurableLimit(
    attemptKey,
    async () => (await msg91VerifyOtp(mobile, code)).ok,
  );
  if (attempt.status === "limited") {
    res.status(429).json({
      message: `Too many incorrect attempts. Try again in ${retryAfterText(attempt.retryAfterMs)}.`,
    });
    return;
  }
  if (attempt.status === "in_flight") {
    res.status(429).json({
      message: `Verification already in progress. Try again in ${retryAfterText(attempt.retryAfterMs)}.`,
    });
    return;
  }
  if (attempt.status === "provider_error") {
    req.log.error("Unexpected error calling MSG91 verify");
  }
  if (attempt.status !== "approved") {
    // Use a generic message to avoid leaking whether provider rejected the code
    // specifically vs. other failure modes.
    res.status(401).json({ message: "Incorrect or expired code. Please try again." });
    return;
  }

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
}));

// ── Registration (email OTP verification) ────────────────────────────────
// Public registration creates dealer (shop owner) accounts only. Staff must
// be provisioned by an authenticated dealer through the staff endpoints.
router.post("/auth/register/start", asyncHandler(async (req, res) => {
  const {
    name,
    businessName,
    email,
    mobile,
    gstNumber,
    shopAddress,
  } = req.body ?? {};
  if (req.body?.role !== undefined && req.body.role !== "dealer") {
    res.status(403).json({ message: "Public registration is limited to dealer accounts." });
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
  if (
    typeof businessName !== "string" || !businessName.trim() ||
    typeof shopAddress !== "string" || !shopAddress.trim()
  ) {
    res.status(400).json({ message: "Missing or invalid registration details" });
    return;
  }
  if (typeof gstNumber === "string" && gstNumber.trim() && gstNumber.trim().length !== 15) {
    res.status(400).json({ message: "GST number must be 15 characters" });
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
  // 60-second cooldown per email between OTP sends (covers resend too)
  const cooldown = checkWindowLimit(`otpreq:register:${normEmail}`, 1, 60 * 1000);
  if (cooldown.limited) {
    res.status(429).json({
      message: `Please wait ${retryAfterText(cooldown.retryAfterMs)} before requesting another code.`,
    });
    return;
  }
  const code = await createOtp(normEmail, "register", {
    kind: "dealer",
    name: name.trim(),
    businessName: businessName.trim(),
    email: normEmail,
    mobile,
    gstNumber: typeof gstNumber === "string" && gstNumber.trim() ? gstNumber.trim() : null,
    shopAddress: shopAddress.trim(),
    role: "dealer",
  });
  try {
    const resendEmailId = await sendOtpEmail(normEmail, code, "registration", {
      avarpus_email_kind: "registration_verification",
    });
    // Resend echoes these tags in its signed delivery webhooks. The message ID
    // is not exposed to the customer and is only used for safe event records.
    if (!resendEmailId) {
      req.log.warn("Registration verification email was accepted without a Resend message ID");
    }
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
    name: string;
    businessName: string | null;
    email: string;
    mobile: string;
    gstNumber: string | null;
    shopAddress: string | null;
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
  // Legacy password records remain for existing data compatibility; account
  // access is solely by mobile OTP.
  const legacyPasswordHash = hashPassword(generateToken());
  // Role is ALWAYS dealer for public registration — never taken from input.
  // User + shop provisioning happen in ONE transaction so a partial failure
  // can never leave an active dealer without a shop/workspace.
  const updated = await db.transaction(async (tx) => {
    const [created] = await tx.insert(usersTable).values({
      name: p.name,
      email: p.email,
      mobile: p.mobile,
      passwordHash: legacyPasswordHash,
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
  res.json({
    message: "Email verified. Sign in with mobile OTP to open your account.",
    user: publicUser(updated),
  });
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
