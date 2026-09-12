import { Router, type IRouter } from "express";
import { and, eq, or } from "drizzle-orm";
import { db, shopsTable, usersTable, dealersTable, customersTable, customerUsersTable } from "@workspace/db";
import {
  consumeOtp,
  createOtp,
  invalidateOtp,
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
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import {
  getHanuOtpStatus,
  hanuSendOtp,
  normaliseIndianMobile,
} from "../lib/hanuOtp";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  claimPendingUpload,
  completePendingUpload,
  refreshPendingUploadClaim,
  releasePendingUpload,
} from "../lib/pendingUploads";
import { lockNormalizedMobiles } from "../lib/mobileIdentityLock";
import {
  AuthMeUpdateBody,
  AuthOtpRequestBody,
  AuthOtpResendBody,
  AuthOtpVerifyBody,
  AuthRegisterStartBody,
  AuthRegisterVerifyBody,
  AuthTrustedDeviceRecoverBody,
} from "@workspace/api-zod";
import { parseBody, uuidParam } from "../lib/validate";
import {
  MAX_PROFILE_UPLOAD_BYTES,
  PROFILE_UPLOAD_CONTENT_TYPES,
  bytesMatchContentType,
} from "../lib/uploadPolicy";

const router: IRouter = Router();
router.param("id", uuidParam);
const objectStorageService = new ObjectStorageService();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Says what is actually wrong: the SMS provider only delivers to 10-digit
// Indian numbers starting with 6-9, so "invalid" alone leaves people guessing.
const INVALID_MOBILE_MESSAGE =
  "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.";

// Roles a public STAFF registration may request. Dealer/admin/super_admin
// can never be requested here.
const STAFF_ROLES = ["reception", "technician", "store_manager", "accountant"] as const;

// Best-effort device description captured at sign-in: prefer the validated
// client-sent `deviceInfo` field, then fall back to the User-Agent header.
function deviceInfoFrom(req: Request, parsedDeviceInfo?: string): string | null {
  const device = parsedDeviceInfo;
  if (typeof device === "string" && device.trim()) {
    return device.trim().slice(0, 120);
  }
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua.trim().slice(0, 120) : null;
}

// Accounts whose business identity is derived from dealer/customer rows that
// carry their mobile. Shop owners, staff and super admins are never in here.
function isPortalLinkableRole(role: string): boolean {
  return role === "customer" || role === "dealer_owner" || role === "dealer_staff";
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function reloadUser(tx: Tx, userId: string) {
  const [current] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return current;
}

// Link every matching customer row of ONE shop to this login. A row already
// claimed by a different login is left alone (customer_id is unique), so a
// stale or mistyped record can never be re-pointed at a newer account.
// Returns how many rows of that shop this login owns afterwards.
async function linkOwnedCustomerRows(
  tx: Tx,
  userId: string,
  shopId: string,
  customerMatches: Array<{ id: string; shopId: string }>,
): Promise<number> {
  const inShop = customerMatches.filter((customer) => customer.shopId === shopId);
  if (inShop.length > 0) {
    await tx.insert(customerUsersTable)
      .values(inShop.map((customer) => ({ userId, customerId: customer.id, shopId })))
      .onConflictDoNothing();
  }
  const owned = await tx.select({ id: customerUsersTable.id })
    .from(customerUsersTable)
    .where(and(eq(customerUsersTable.userId, userId), eq(customerUsersTable.shopId, shopId)));
  return owned.length;
}

// ── Mobile OTP login ──────────────────────────────────────────────────────
router.post("/auth/otp/request", asyncHandler(async (req, res) => {
  const body = parseBody(AuthOtpRequestBody, req, res);
  if (!body) return;
  const rawMobile = body.mobile;
  // Accept 10-digit local, +91XXXXXXXXXX, or 91XXXXXXXXXX; normalise to 10-digit.
  const mobile = normaliseIndianMobile(rawMobile);
  if (!mobile) {
    res.status(400).json({ message: INVALID_MOBILE_MESSAGE });
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
  const code = await createOtp(mobile, "login");
  const result = await hanuSendOtp(mobile, code);
  if (!result.ok) {
    await invalidateOtp(mobile, "login");
    req.log.warn({ providerReason: result.reason }, "Hanu OTP send failed");
    if (result.invalidNumber) {
      res.status(400).json({ message: INVALID_MOBILE_MESSAGE });
      return;
    }
    res.status(502).json({
      message: "Could not send the SMS verification code. Please try again shortly.",
    });
    return;
  }
  req.log.info(
    {
      providerMessage: result.providerMessage,
      providerReference: result.providerReference,
    },
    "Hanu OTP request accepted",
  );
  res.json({
    message: "If this mobile number is valid, a verification code has been sent.",
  });
}));

// ── Mobile OTP resend ─────────────────────────────────────────────────────
router.post("/auth/otp/resend", asyncHandler(async (req, res) => {
  const body = parseBody(AuthOtpResendBody, req, res);
  if (!body) return;
  const rawMobile = body.mobile;
  const mobile = normaliseIndianMobile(rawMobile);
  if (!mobile) {
    res.status(400).json({ message: INVALID_MOBILE_MESSAGE });
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
  const code = await createOtp(mobile, "login");
  const result = await hanuSendOtp(mobile, code);
  if (!result.ok) {
    await invalidateOtp(mobile, "login");
    req.log.warn({ providerReason: result.reason }, "Hanu OTP resend failed");
    if (result.invalidNumber) {
      res.status(400).json({ message: INVALID_MOBILE_MESSAGE });
      return;
    }
    res.status(502).json({
      message: "Could not resend the SMS verification code. Please try again shortly.",
    });
    return;
  }
  req.log.info(
    {
      providerMessage: result.providerMessage,
      providerReference: result.providerReference,
    },
    "Hanu OTP resend accepted",
  );
  res.json({
    message: "If this mobile number is valid, a new code has been sent.",
  });
}));

router.post("/auth/otp/verify", asyncHandler(async (req, res) => {
  const body = parseBody(AuthOtpVerifyBody, req, res);
  if (!body) return;
  const { mobile: rawMobile, code, androidDeviceId } = body;
  // Accept 10-digit, +91 or 91-prefixed; normalise to local 10-digit for DB lookup.
  const mobile = normaliseIndianMobile(rawMobile);
  if (!mobile) {
    res.status(400).json({ message: INVALID_MOBILE_MESSAGE });
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
    req.log.error("Unexpected error verifying SMS OTP");
  }
  if (attempt.status !== "approved") {
    // Use a generic message to avoid leaking whether provider rejected the code
    // specifically vs. other failure modes.
    res.status(401).json({ message: "Incorrect or expired code. Please try again." });
    return;
  }

  // A verified mobile may already be on file as a B2B dealer party and/or as
  // one or more walk-in customer rows (the same person entered twice, or on
  // file at more than one shop). OTP proves control of the number, so every
  // matching record belongs to this caller: never refuse the login because the
  // number appears more than once. Resolution is done after OTP verification,
  // in one transaction, and never replaces an existing business identity.
  const account = await db.transaction(async (tx) => {
    // Serialize resolution and customer-link claims for this normalized phone
    // across API processes. hashtext is used only as a transaction-local lock
    // key; the normalized phone is never persisted by this lock.
    await lockNormalizedMobiles(tx, mobile);
    const [existing] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.mobile, mobile))
      .limit(1);
    // Inactive users are authoritative and can never be reactivated by OTP.
    if (existing && !existing.isActive) return { user: existing, created: false };
    // Shop owners, staff and super admins are authoritative. Do not use a
    // dealer/customer row that happens to share the number to reshape them.
    if (existing && !isPortalLinkableRole(existing.role)) {
      return { user: existing, created: false };
    }

    // Existing data predates normalized mobile columns. Normalize each stored
    // value using the same strict Indian-mobile routine as the OTP boundary.
    const [dealers, customers] = await Promise.all([
      tx.select().from(dealersTable).where(eq(dealersTable.isActive, true)),
      tx.select().from(customersTable),
    ]);
    // Most recent relationship first: when the number is on file more than
    // once, the newest record decides which shop the portal opens on. Rows
    // written in one transaction share a created_at, so break ties on id to
    // keep the choice stable across logins.
    const newestFirst = <T extends { id: string; createdAt: Date }>(a: T, b: T) =>
      b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
    const dealerMatches = dealers
      .filter((dealer) => normaliseIndianMobile(dealer.mobile) === mobile)
      .sort(newestFirst);
    const customerMatches = customers
      .filter((customer) => normaliseIndianMobile(customer.mobile) === mobile)
      .sort(newestFirst);

    let user = existing;
    if (!user) {
      const matchedName = dealerMatches[0]?.name ?? customerMatches[0]?.name ?? "Customer";
      const [created] = await tx
        .insert(usersTable)
        .values({
          name: matchedName,
          email: `otp-customer-${generateToken().slice(0, 24)}@standalone.local`,
          mobile, passwordHash: null, role: "customer", isActive: true,
          displayNameCompletedAt: null,
        })
        .onConflictDoNothing({ target: usersTable.mobile })
        .returning();
      if (!created) {
        const [raced] = await tx.select().from(usersTable).where(eq(usersTable.mobile, mobile)).limit(1);
        return { user: raced, created: false };
      }
      user = created;
    }

    // A standalone account attaches to a business identity here. A dealer
    // party wins over walk-in customer rows: the dealer portal can also show
    // the repairs booked under this person's customer rows in the same shop.
    if (user.role === "customer" && !user.shopId && !user.dealerId) {
      if (dealerMatches.length > 0) {
        const dealer = dealerMatches[0];
        const [upgraded] = await tx.update(usersTable)
          .set({ role: "dealer_owner", shopId: dealer.shopId, dealerId: dealer.id })
          .where(and(eq(usersTable.id, user.id), eq(usersTable.role, "customer")))
          .returning();
        user = upgraded ?? await reloadUser(tx, user.id);
      } else if (customerMatches.length > 0) {
        // Try the newest shop first. A customer row already claimed by another
        // login is skipped rather than treated as a conflict; the account only
        // opens on a shop where it actually owns at least one customer row.
        const shopOrder = [...new Set(customerMatches.map((customer) => customer.shopId))];
        for (const shopId of shopOrder) {
          const owned = await linkOwnedCustomerRows(tx, user.id, shopId, customerMatches);
          if (owned === 0) continue;
          const [linked] = await tx.update(usersTable)
            .set({ role: "customer", shopId, dealerId: null })
            .where(and(eq(usersTable.id, user.id), eq(usersTable.role, "customer")))
            .returning();
          user = linked ?? await reloadUser(tx, user.id);
          break;
        }
      }
    }

    // Keep an attached portal account's customer links complete: rows added
    // under this number after the first login (or alongside a dealer party)
    // are picked up on every verification. Rows in other shops stay unlinked —
    // the portal is single-shop.
    if (user.shopId && isPortalLinkableRole(user.role)) {
      await linkOwnedCustomerRows(tx, user.id, user.shopId, customerMatches);
    }
    return { user, created: !existing };
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
  const deviceInfo = deviceInfoFrom(req, body.deviceInfo);
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
  const body = parseBody(AuthTrustedDeviceRecoverBody, req, res);
  if (!body) return;
  const androidDeviceId = body.androidDeviceId;
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
  const body = parseBody(AuthRegisterStartBody, req, res);
  if (!body) return;
  const {
    name,
    businessName,
    email,
    mobile,
    gstNumber,
    shopAddress,
  } = body;
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
    await invalidateOtp(normEmail, "register");
    // Keep the provider error in server logs, but never the recipient address.
    req.log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "Registration OTP email delivery failed",
    );
    res.status(502).json({
      message: "Could not send the verification email. Please try again shortly.",
    });
    return;
  }
  res.json({ message: `Verification code sent to ${normEmail}` });
}));

router.post("/auth/register/verify", asyncHandler(async (req, res) => {
  const body = parseBody(AuthRegisterVerifyBody, req, res);
  if (!body) return;
  const { email, code } = body;
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

const PROFILE_PHOTO_REQUIREMENTS =
  `Profile photo must be a valid JPEG, PNG, or WebP image no larger than ${Math.floor(MAX_PROFILE_UPLOAD_BYTES / (1024 * 1024))} MB`;

async function validateStoredProfilePhoto(
  objectPath: string,
  userId: string,
): Promise<{ valid: true; finalPath: string } | { valid: false; message: string }> {
  try {
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const [metadata] = await objectFile.getMetadata();
    const size = Number(metadata.size ?? 0);
    const contentType = String(metadata.contentType ?? "").toLowerCase();
    if (size <= 0 || size > MAX_PROFILE_UPLOAD_BYTES) {
      await objectFile.delete({ ignoreNotFound: true }).catch(() => undefined);
      return { valid: false, message: PROFILE_PHOTO_REQUIREMENTS };
    }
    const [contents] = await objectFile.download();
    const signatureMatches =
      PROFILE_UPLOAD_CONTENT_TYPES.has(contentType)
      && bytesMatchContentType(contents.subarray(0, 12), contentType);
    if (contents.length !== size || contents.length > MAX_PROFILE_UPLOAD_BYTES || !signatureMatches) {
      await objectFile.delete({ ignoreNotFound: true }).catch(() => undefined);
      return { valid: false, message: PROFILE_PHOTO_REQUIREMENTS };
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

// The contract's username pattern is the *stored* form (lowercase). Clients
// may send mixed case or surrounding whitespace; validateProfileUsername
// normalises (NFKC, trim, lowercase) before applying the same pattern, so the
// raw field is accepted here as any string and validated after normalisation.
const AuthMeUpdateRequest = AuthMeUpdateBody.extend({
  profileUsername: z.string().nullish(),
});

router.patch("/auth/me", requireAuth, asyncHandler(async (req, res) => {
  const me = req.user!;
  const body = parseBody(AuthMeUpdateRequest, req, res);
  if (!body) return;
  const { name, mobile, profilePhoto, profileAbout, profileUsername, profileLinks } = body;
  const set: Partial<{
    name: string; mobile: string; profilePhoto: string | null; profileAbout: string | null;
    profileUsername: string | null; profileLinks: string[] | null; displayNameCompletedAt: Date;
  }> = {};
  let claimedProfileUploadPath: string | null = null;
  let claimedProfileUploadToken: string | null = null;
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
    // The mobile is the sign-in identity and the key that business records
    // (customer rows, dealer parties) are auto-linked by at OTP time. Letting
    // a session rewrite it without proving control of the new number would
    // let one account inherit whatever the next OTP on that number matches,
    // so it is immutable here; only a verified OTP may bind a number.
    if (mobile !== me.mobile) {
      res.status(400).json({
        code: "MOBILE_CHANGE_REQUIRES_OTP",
        message: "Your sign-in mobile number cannot be changed here. Sign in with the new number to use it.",
      });
      return;
    }
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
      const claim = await claimPendingUpload({
        objectPath: profilePhoto,
        ownerUserId: me.id,
        purpose: "profile",
      });
      if (!claim) {
        res.status(400).json({ message: "Profile photo does not belong to this account" });
        return;
      }
      claimedProfileUploadPath = profilePhoto;
      claimedProfileUploadToken = claim.token;
      const validation = await validateStoredProfilePhoto(profilePhoto, me.id);
      if (!validation.valid) {
        await releasePendingUpload({
          objectPath: profilePhoto,
          ownerUserId: me.id,
          purpose: "profile",
          token: claimedProfileUploadToken,
        }).catch(() => undefined);
        res.status(400).json({ message: validation.message });
        return;
      }
      const renewed = await refreshPendingUploadClaim({
        objectPath: profilePhoto,
        ownerUserId: me.id,
        purpose: "profile",
        token: claimedProfileUploadToken,
      });
      if (!renewed) {
        res.status(409).json({
          message: "Profile photo processing expired. Please upload it again.",
          code: "PROFILE_PHOTO_CLAIM_EXPIRED",
        });
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
    if (claimedProfileUploadPath && claimedProfileUploadToken) {
      await completePendingUpload({
        objectPath: claimedProfileUploadPath,
        ownerUserId: me.id,
        purpose: "profile",
        token: claimedProfileUploadToken,
      }).catch((claimError) => {
        req.log.warn({ err: claimError }, "Attached profile upload claim cleanup failed");
      });
    }
    res.json({ user: publicUser(updated) });
  } catch (error: unknown) {
    if (claimedProfileUploadPath && claimedProfileUploadToken) {
      await releasePendingUpload({
        objectPath: claimedProfileUploadPath,
        ownerUserId: me.id,
        purpose: "profile",
        token: claimedProfileUploadToken,
      }).catch(() => undefined);
    }
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
  const sessions = await listActiveSessions(req.user!.id, req.sessionToken!, req.user!.role);
  res.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      deviceInfo: s.deviceInfo ?? undefined,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
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
