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
  enrollTrustedDevice,
  checkTrustedDeviceRecoveryLimit,
  hashAndroidDeviceIdentifier,
  isValidAndroidDeviceIdentifier,
  revokeTrustedDeviceForSession,
  recoverTrustedDeviceSession,
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
import { requireRole } from "../middlewares/requireRole";
import { asyncHandler } from "../lib/asyncHandler";
import {
  getHanuOtpStatus,
  hanuSendOtp,
  normaliseIndianMobile,
} from "../lib/hanuOtp";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Roles a public STAFF registration may request. Dealer/admin/super_admin
// can never be requested here.
const STAFF_ROLES = ["reception", "technician", "store_manager", "accountant"] as const;

// Best-effort device description captured at sign-in: prefer the client-sent
// `device` field, fall back to the User-Agent header.
function deviceInfoFrom(req: Request): string | null {
  const device = (req.body ?? {}).deviceInfo ?? (req.body ?? {}).device;
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
  if (!getHanuOtpStatus().configured) {
    res.status(503).json({
      message: "SMS verification is temporarily unavailable. Please try again later.",
    });
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
  // Keep the response generic while sending to every valid number. This lets
  // new users verify that they control a mobile number without revealing
  // account state or making account creation part of login.
  const genericMessage = "If this mobile number is valid, a verification code has been sent.";
  res.json({ message: genericMessage });
  void (async () => {
    try {
      const code = await createOtp(mobile, "login");
      const result = await hanuSendOtp(mobile, code);
      if (!result.ok) req.log.warn("Hanu OTP send failed");
    } catch {
      req.log.error("Unexpected error calling Hanu OTP");
    }
  })();
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
  if (!getHanuOtpStatus().configured) {
    res.status(503).json({
      message: "SMS verification is temporarily unavailable. Please try again later.",
    });
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
  const genericMessage = "If this mobile number is valid, a new code has been sent.";
  res.json({ message: genericMessage });
  void (async () => {
    try {
      const code = await createOtp(mobile, "login");
      const result = await hanuSendOtp(mobile, code);
      if (!result.ok) req.log.warn("Hanu OTP resend failed");
    } catch {
      req.log.error("Unexpected error calling Hanu OTP resend");
    }
  })();
}));

router.post("/auth/otp/verify", asyncHandler(async (req, res) => {
  const { mobile: rawMobile, code, androidDeviceId } = req.body ?? {};
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
  if (androidDeviceId !== undefined && !isValidAndroidDeviceIdentifier(androidDeviceId)) {
    res.status(400).json({ message: "A valid Android device identifier is required" });
    return;
  }

  const attemptKey = `otpverify:${mobile}`;
  const attempt = await verifyOtpWithDurableLimit(
    attemptKey,
    async () => (await consumeOtp(mobile, "login", code)).ok,
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
    req.log.error("Unexpected error verifying Hanu OTP");
  }
  if (attempt.status !== "approved") {
    // Use a generic message to avoid leaking whether provider rejected the code
    // specifically vs. other failure modes.
    res.status(401).json({ message: "Incorrect or expired code. Please try again." });
    return;
  }

  // OTP ownership is sufficient to bootstrap a standalone customer account.
  // The mobile unique index is the cross-process mutex: concurrent approvals
  // either return the already-created active user or exactly one inserts it.
  // Existing records are never changed, notably inactive accounts stay denied.
  const account = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.mobile, mobile))
      .limit(1);
    if (existing) return { user: existing, created: false };
    const [created] = await tx
      .insert(usersTable)
      .values({
        name: "Customer",
        // This internal address is never used for authentication. A random
        // suffix avoids an attacker pre-claiming a predictable legacy-email
        // value and blocking phone-only account creation.
        email: `otp-customer-${generateToken().slice(0, 24)}@standalone.local`,
        mobile,
        passwordHash: null,
        role: "customer",
        isActive: true,
        displayNameCompletedAt: null,
      })
      .onConflictDoNothing({ target: usersTable.mobile })
      .returning();
    if (created) return { user: created, created: true };
    const [raced] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.mobile, mobile))
      .limit(1);
    return { user: raced, created: false };
  });
  const user = account.user;
  if (!user || !user.isActive) {
    // An existing inactive account cannot be reactivated by OTP verification.
    res.status(401).json({ message: "Account not found or inactive" });
    return;
  }
  // A verified mobile login stays active until the user explicitly signs out
  // or revokes the session from Active Sessions.
  const remember = true;
  const deviceInfo = deviceInfoFrom(req);
  let trustedDeviceId: string | null = null;
  // Device enrollment is opt-in: legacy OTP clients retain their existing
  // session behavior. The raw Android ID is only held in this request scope.
  if (androidDeviceId !== undefined) {
    const enrolledAt = new Date();
    const trust = await enrollTrustedDevice(
      user.id,
      hashAndroidDeviceIdentifier(androidDeviceId),
      deviceInfo,
      enrolledAt,
    );
    trustedDeviceId = trust.id;
  }
  const token = await createSession(user.id, remember, deviceInfo, { trustedDeviceId });
  await recordLoginEvent(user.id, "otp", remember, deviceInfo);
  const responseUser = publicUser(user);
  res.json({ token, user: responseUser, needsDisplayName: responseUser.needsDisplayName });
}));

// Public but intentionally non-enumerating recovery. A valid Android ID maps
// to exactly one active, unrevoked trust or the request fails generically.
router.post("/auth/trusted-device/recover", asyncHandler(async (req, res) => {
  const androidDeviceId = req.body?.androidDeviceId;
  if (!isValidAndroidDeviceIdentifier(androidDeviceId)) {
    res.status(400).json({ message: "A valid Android device identifier is required" });
    return;
  }
  const androidIdHash = hashAndroidDeviceIdentifier(androidDeviceId);
  const throttled = await checkTrustedDeviceRecoveryLimit(req.ip ?? "unknown", androidIdHash);
  if (throttled.limited) {
    res.status(429).json({
      message: `Too many recovery attempts. Try again in ${retryAfterText(throttled.retryAfterMs)}.`,
    });
    return;
  }
  const match = await recoverTrustedDeviceSession(androidIdHash);
  if (!match) {
    res.status(401).json({ message: "Unable to recover this device. Sign in with OTP." });
    return;
  }
  // Recovery never mutates the trust. The resulting session cannot outlive the
  // fixed OTP-time recovery deadline (and is therefore also below 48 hours).
  await recordLoginEvent(match.user.id, "trusted_device", false, match.trust.deviceInfo);
  res.json({ token: match.token, user: publicUser(match.user) });
}));

// Configuration status is intentionally limited to super administrators and
// never returns the provider credential itself.
router.get(
  "/auth/otp/provider-status",
  requireAuth,
  requireRole("super_admin"),
  (_req, res) => {
    res.json(getHanuOtpStatus());
  },
);

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

// ── Self profile update ───────────────────────────────────────────────────
const DISPLAY_NAME_MAX_LENGTH = 120;
const PROFILE_ABOUT_MAX_LENGTH = 500;
const PROFILE_USERNAME_RE = /^[a-z0-9][a-z0-9_]{2,29}$/;
const PROFILE_LINK_MAX_COUNT = 8;
const PROFILE_LINK_MAX_LENGTH = 2_048;

function validateDisplayName(value: unknown): { name: string } | { message: string } {
  if (typeof value !== "string") {
    return { message: "Name must be text" };
  }
  const name = value.normalize("NFC").trim();
  if (!name) {
    return { message: "Name cannot be empty" };
  }
  if (Array.from(name).length > DISPLAY_NAME_MAX_LENGTH) {
    return { message: `Name must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer` };
  }
  // Names are displayed in room lists and notifications. Reject control,
  // bidi-override, and markup characters while allowing normal Unicode names,
  // spaces, accents, punctuation, and emoji.
  if (/[\u0000-\u001F\u007F-\u009F\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069<>]/u.test(name)) {
    return { message: "Name contains unsupported characters" };
  }
  return { name };
}

function validateProfileUsername(value: unknown): { username: string | null } | { message: string } {
  if (value === null || value === "") return { username: null };
  if (typeof value !== "string") return { message: "Username must be text" };
  const username = value.normalize("NFKC").trim().toLowerCase();
  if (!PROFILE_USERNAME_RE.test(username)) {
    return { message: "Username must be 3-30 lowercase letters, numbers, or underscores" };
  }
  return { username };
}

function validateProfileLinks(value: unknown): { links: string[] | null } | { message: string } {
  if (value === null) return { links: null };
  if (!Array.isArray(value) || value.length > PROFILE_LINK_MAX_COUNT) {
    return { message: `Profile links must contain at most ${PROFILE_LINK_MAX_COUNT} URLs` };
  }
  const links: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length > PROFILE_LINK_MAX_LENGTH) {
      return { message: "Each profile link must be a URL of 2048 characters or fewer" };
    }
    try {
      const url = new URL(item);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported protocol");
      links.push(url.toString());
    } catch {
      return { message: "Each profile link must be a valid http or https URL" };
    }
  }
  return { links };
}

async function validateStoredProfilePhoto(
  objectPath: string,
  userId: string,
): Promise<{ valid: true; finalPath: string } | { valid: false; message: string }> {
  try {
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const [metadata] = await objectFile.getMetadata();
    const size = Number(metadata.size ?? 0);
    const contentType = String(metadata.contentType ?? "").toLowerCase();
    if (size <= 0 || size > 10 * 1024 * 1024) {
      await objectFile.delete({ ignoreNotFound: true }).catch(() => undefined);
      return {
        valid: false,
        message: "Profile photo must be a valid JPEG, PNG, or WebP image no larger than 10 MB",
      };
    }
    const [contents] = await objectFile.download();
    const head = contents.subarray(0, 12);
    const isJpeg =
      head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    const isPng =
      head.length >= 8 &&
      head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp =
      head.length >= 12 &&
      head.subarray(0, 4).toString("ascii") === "RIFF" &&
      head.subarray(8, 12).toString("ascii") === "WEBP";
    const signatureMatches =
      (contentType === "image/jpeg" && isJpeg) ||
      (contentType === "image/png" && isPng) ||
      (contentType === "image/webp" && isWebp);
    if (contents.length !== size || contents.length > 10 * 1024 * 1024 || !signatureMatches) {
      await objectFile.delete({ ignoreNotFound: true }).catch(() => undefined);
      return {
        valid: false,
        message: "Profile photo must be a valid JPEG, PNG, or WebP image no larger than 10 MB",
      };
    }
    const finalPath = await objectStorageService.saveObjectEntityWithPrefix(
      `profiles/${userId}/final`,
      contents,
      contentType,
    );
    await objectFile.delete({ ignoreNotFound: true }).catch(() => undefined);
    return { valid: true, finalPath };
  } catch {
    return { valid: false, message: "Uploaded profile photo could not be verified" };
  }
}

router.patch("/auth/me", requireAuth, asyncHandler(async (req, res) => {
  const me = req.user!;
  const { name, mobile, profilePhoto, profileAbout, profileUsername, profileLinks } = req.body ?? {};
  const set: Partial<{
    name: string; mobile: string; profilePhoto: string | null; profileAbout: string | null;
    profileUsername: string | null; profileLinks: string[] | null; displayNameCompletedAt: Date;
  }> = {};
  if (name !== undefined) {
    const validatedName = validateDisplayName(name);
    if ("message" in validatedName) {
      res.status(400).json({ message: validatedName.message });
      return;
    }
    set.name = validatedName.name;
    set.displayNameCompletedAt = new Date();
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
  if (profilePhoto !== undefined) {
    if (profilePhoto === null || profilePhoto === "") {
      set.profilePhoto = null;
    } else if (
      typeof profilePhoto !== "string" ||
      !profilePhoto.startsWith(`/objects/uploads/profiles/${me.id}/`) ||
      !/^\/objects\/uploads\/profiles\/[0-9a-f-]+\/[0-9a-f-]+$/i.test(profilePhoto)
    ) {
      res.status(400).json({ message: "Profile photo must be uploaded to your profile storage path" });
      return;
    } else {
      const validation = await validateStoredProfilePhoto(profilePhoto, me.id);
      if (!validation.valid) {
        res.status(400).json({ message: validation.message });
        return;
      }
      set.profilePhoto = validation.finalPath;
    }
  }
  if (profileAbout !== undefined) {
    if (profileAbout === null || profileAbout === "") {
      set.profileAbout = null;
    } else if (typeof profileAbout !== "string" || Array.from(profileAbout.normalize("NFC").trim()).length > PROFILE_ABOUT_MAX_LENGTH) {
      res.status(400).json({ message: `Profile about must be ${PROFILE_ABOUT_MAX_LENGTH} characters or fewer` });
      return;
    } else {
      set.profileAbout = profileAbout.normalize("NFC").trim();
    }
  }
  if (profileUsername !== undefined) {
    const validatedUsername = validateProfileUsername(profileUsername);
    if ("message" in validatedUsername) {
      res.status(400).json({ message: validatedUsername.message });
      return;
    }
    if (validatedUsername.username !== null && validatedUsername.username !== me.profileUsername) {
      const [clash] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.profileUsername, validatedUsername.username)).limit(1);
      if (clash && clash.id !== me.id) {
        res.status(409).json({ message: "Another account already uses this username" });
        return;
      }
    }
    set.profileUsername = validatedUsername.username;
  }
  if (profileLinks !== undefined) {
    const validatedLinks = validateProfileLinks(profileLinks);
    if ("message" in validatedLinks) {
      res.status(400).json({ message: validatedLinks.message });
      return;
    }
    set.profileLinks = validatedLinks.links;
  }
  if (Object.keys(set).length === 0) {
    res.json({ user: publicUser(me) });
    return;
  }
  try {
    const [updated] = await db
      .update(usersTable)
      .set(set)
      .where(eq(usersTable.id, me.id))
      .returning();
    res.json({ user: publicUser(updated) });
  } catch (error: unknown) {
    // The preflight check makes the usual case friendly; the unique index is
    // still authoritative when two requests race to claim the same handle.
    if (
      set.profileUsername !== undefined &&
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({ message: "Another account already uses this username" });
      return;
    }
    throw error;
  }
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
  await revokeTrustedDeviceForSession(req.sessionToken!);
  await deleteSession(req.sessionToken!);
  res.json({ message: "Signed out" });
}));

export default router;
