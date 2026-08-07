import { Router, type IRouter } from "express";
import { eq, or } from "drizzle-orm";
import { db, otpCodesTable, usersTable } from "@workspace/db";
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
  sha256,
  verifyPassword,
} from "../lib/authUtils";
import type { Request } from "express";
import { sendOtpEmail } from "../lib/mailer";
import {
  checkFailureLockout,
  checkWindowLimit,
  clearFailures,
  recordFailure,
  retryAfterText,
} from "../lib/rateLimit";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const { mobile } = req.body ?? {};
  if (typeof mobile !== "string" || !/^\d{10}$/.test(mobile)) {
    res.status(400).json({ message: "A valid 10-digit mobile number is required" });
    return;
  }
  // Throttle OTP requests per mobile number and per IP to prevent email flooding.
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
  // Generic response — identical for known/unknown mobiles to prevent account enumeration
  const genericMessage =
    "If this mobile number is registered, a verification code has been sent to the account's email.";
  if (user?.isActive) {
    try {
      const code = await createOtp(mobile, "login");
      await sendOtpEmail(user.email, code, "sign-in");
    } catch (err) {
      // Log but do not propagate — response must be identical for any mobile number
      console.error("OTP email delivery failed:", err instanceof Error ? err.message : err);
    }
  }
  res.json({ message: genericMessage });
}));

router.post("/auth/otp/verify", asyncHandler(async (req, res) => {
  const { mobile, code, rememberMe } = req.body ?? {};
  if (typeof mobile !== "string" || typeof code !== "string") {
    res.status(400).json({ message: "Mobile and code are required" });
    return;
  }
  const result = await consumeOtp(mobile, "login", code);
  if (!result.ok) {
    res.status(401).json({ message: result.error });
    return;
  }
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.mobile, mobile))
    .limit(1);
  const user = rows[0];
  if (!user || !user.isActive) {
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
  } = req.body ?? {};
  const ALLOWED_ROLES = ["reception", "dealer", "admin"] as const;
  const requestedRole =
    typeof role === "string" && (ALLOWED_ROLES as readonly string[]).includes(role)
      ? role
      : "reception";
  if (
    typeof name !== "string" || !name.trim() ||
    typeof businessName !== "string" || !businessName.trim() ||
    typeof email !== "string" || !EMAIL_RE.test(email.trim()) ||
    typeof mobile !== "string" || !/^\d{10}$/.test(mobile) ||
    typeof shopAddress !== "string" || !shopAddress.trim()
  ) {
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
    name: name.trim(),
    businessName: businessName.trim(),
    email: normEmail,
    mobile,
    passwordHash: hashPassword(password),
    gstNumber: typeof gstNumber === "string" && gstNumber.trim() ? gstNumber.trim() : null,
    shopAddress: shopAddress.trim(),
    role: requestedRole,
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
    name: string;
    businessName: string;
    email: string;
    mobile: string;
    passwordHash: string;
    gstNumber: string | null;
    shopAddress: string;
    role?: string;
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
  await db.insert(usersTable).values({
    name: p.name,
    email: p.email,
    mobile: p.mobile,
    passwordHash: p.passwordHash,
    role: (p.role === "dealer" || p.role === "admin" ? p.role : "reception") as "reception" | "dealer" | "admin",
    isActive: false, // pending admin approval
    designation: "Owner",
    joinDate: new Date().toISOString().split("T")[0],
    businessName: p.businessName,
    gstNumber: p.gstNumber,
    shopAddress: p.shopAddress,
  });
  res.json({ message: "Account created. It will be activated after admin approval." });
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
  await db
    .update(usersTable)
    .set({ passwordHash: hashPassword(newPassword) })
    .where(eq(usersTable.email, normEmail));
  res.json({ message: "Password updated. Sign in with your new password." });
}));

// ── Session ───────────────────────────────────────────────────────────────
router.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

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
