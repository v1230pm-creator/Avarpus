import { Router, type IRouter } from "express";
import { eq, or } from "drizzle-orm";
import { db, otpCodesTable, usersTable } from "@workspace/db";
import {
  consumeOtp,
  createOtp,
  createSession,
  deleteSession,
  generateToken,
  hashPassword,
  publicUser,
  sha256,
  verifyPassword,
} from "../lib/authUtils";
import { sendOtpEmail } from "../lib/mailer";
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

// ── Email + password login ────────────────────────────────────────────────
router.post("/auth/login", asyncHandler(async (req, res) => {
  const { emailOrMobile, password } = req.body ?? {};
  if (typeof emailOrMobile !== "string" || typeof password !== "string") {
    res.status(400).json({ message: "Email/mobile and password are required" });
    return;
  }
  const identifier = emailOrMobile.trim().toLowerCase();
  const rows = await db
    .select()
    .from(usersTable)
    .where(
      or(eq(usersTable.email, identifier), eq(usersTable.mobile, emailOrMobile.trim())),
    )
    .limit(1);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ message: "Account pending admin approval" });
    return;
  }
  const token = await createSession(user.id);
  res.json({ token, user: publicUser(user) });
}));

// ── Mobile OTP login ──────────────────────────────────────────────────────
router.post("/auth/otp/request", asyncHandler(async (req, res) => {
  const { mobile } = req.body ?? {};
  if (typeof mobile !== "string" || !/^\d{10}$/.test(mobile)) {
    res.status(400).json({ message: "A valid 10-digit mobile number is required" });
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
  const { mobile, code } = req.body ?? {};
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
  const token = await createSession(user.id);
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
  } = req.body ?? {};
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
  const code = await createOtp(normEmail, "register", {
    name: name.trim(),
    businessName: businessName.trim(),
    email: normEmail,
    mobile,
    passwordHash: hashPassword(password),
    gstNumber: typeof gstNumber === "string" && gstNumber.trim() ? gstNumber.trim() : null,
    shopAddress: shopAddress.trim(),
  });
  await sendOtpEmail(normEmail, code, "registration");
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
    role: "reception",
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

router.post("/auth/logout", requireAuth, asyncHandler(async (req, res) => {
  await deleteSession(req.sessionToken!);
  res.json({ message: "Signed out" });
}));

export default router;
