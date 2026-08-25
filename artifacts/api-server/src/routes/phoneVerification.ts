import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  db,
  deviceAuthChallengesTable,
  phoneVerificationChallengesTable,
  sessionsTable,
  smsVerificationEventsTable,
  userDevicesTable,
  usersTable,
} from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middlewares/requireAuth";
import {
  createOpaqueToken,
  createPhoneChallenge,
  DEVICE_AUTH_CHALLENGE_TTL_MS,
  extractPhoneChallenge,
  hashVerificationValue,
  isBridgeTimestampFresh,
  verifyBridgeSignature,
  verifyDeviceSignature,
  PHONE_VERIFICATION_TTL_MS,
} from "../lib/phoneVerification";
import { publicUser, recordLoginEvent } from "../lib/authUtils";
import { normaliseIndianMobile } from "../lib/msg91";
import { checkWindowLimit, retryAfterText } from "../lib/rateLimit";

const router: IRouter = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DEVICE_ID_LENGTH = 200;
const MAX_PUBLIC_KEY_LENGTH = 8192;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

type AuthedRequest = Request & { user: NonNullable<Request["user"]> };

function e164(raw: string): { local: string; value: string } | null {
  const local = normaliseIndianMobile(raw);
  return local ? { local, value: `+91${local}` } : null;
}

function validDeviceId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= MAX_DEVICE_ID_LENGTH;
}

function validPublicKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.includes("BEGIN PUBLIC KEY") &&
    value.length <= MAX_PUBLIC_KEY_LENGTH
  );
}

function bridgeThrottle(req: Request, sender: string): string | null {
  const senderLimit = checkWindowLimit(`smsbridge:sender:${sender}`, 20, 15 * 60 * 1000);
  const gatewayLimit = checkWindowLimit(
    `smsbridge:ip:${req.ip ?? "unknown"}`,
    100,
    15 * 60 * 1000,
  );
  const limited = [senderLimit, gatewayLimit].find((s) => s.limited);
  return limited ? `Too many verification messages. Try again in ${retryAfterText(limited.retryAfterMs)}.` : null;
}

// Start a SIM verification request. The challenge is returned only to the
// Android client over HTTPS so it can be placed in the user-confirmed SMS.
router.post("/auth/phone-verification/start", asyncHandler(async (req, res) => {
  const { mobile: rawMobile, deviceId, devicePublicKey } = req.body ?? {};
  if (typeof rawMobile !== "string") {
    res.status(400).json({ message: "A valid Indian mobile number is required" });
    return;
  }
  const phone = e164(rawMobile);
  if (!phone) {
    res.status(400).json({ message: "A valid Indian mobile number is required" });
    return;
  }
  if (deviceId !== undefined && !validDeviceId(deviceId)) {
    res.status(400).json({ message: "Invalid device identifier" });
    return;
  }
  if (devicePublicKey !== undefined && !validPublicKey(devicePublicKey)) {
    res.status(400).json({ message: "Invalid device public key" });
    return;
  }

  const mobileLimit = checkWindowLimit(`sim:start:mobile:${phone.value}`, 3, 15 * 60 * 1000);
  const ipLimit = checkWindowLimit(`sim:start:ip:${req.ip ?? "unknown"}`, 15, 15 * 60 * 1000);
  const limited = [mobileLimit, ipLimit].find((s) => s.limited);
  if (limited) {
    res.status(429).json({
      message: `Too many verification attempts. Try again in ${retryAfterText(limited.retryAfterMs)}.`,
    });
    return;
  }

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.mobile, phone.local))
    .limit(1);
  const registered = Boolean(existing?.isActive);
  const challenge = createPhoneChallenge();
  const statusToken = createOpaqueToken();
  const expiresAt = new Date(Date.now() + PHONE_VERIFICATION_TTL_MS);

  const [created] = await db.transaction(async (tx) => {
    await tx
      .update(phoneVerificationChallengesTable)
      .set({ status: "expired" })
      .where(
        and(
          eq(phoneVerificationChallengesTable.phoneNumber, phone.value),
          eq(phoneVerificationChallengesTable.status, "pending"),
        ),
      );
    return tx
      .insert(phoneVerificationChallengesTable)
      .values({
        userId: registered ? existing.id : null,
        phoneNumber: phone.value,
        challengeHash: hashVerificationValue(challenge),
        statusTokenHash: hashVerificationValue(statusToken),
        deviceId: typeof deviceId === "string" ? deviceId.trim() : null,
        devicePublicKey: typeof devicePublicKey === "string" ? devicePublicKey.trim() : null,
        expiresAt,
      })
      .returning({ id: phoneVerificationChallengesTable.id });
  });

  res.json({
    verificationId: created.id,
    challenge,
    statusToken,
    expiresAt: expiresAt.toISOString(),
    registered,
  });
}));

// The Android app polls this capability-protected status endpoint because the
// SMS bridge is a separate service and cannot call back into the phone app.
// The session token is released once only, after the bridge has verified the SMS.
router.post("/auth/phone-verification/status", asyncHandler(async (req, res) => {
  const { verificationId, statusToken } = req.body ?? {};
  if (
    typeof verificationId !== "string" ||
    !UUID_RE.test(verificationId) ||
    typeof statusToken !== "string" ||
    statusToken.length < 32
  ) {
    res.status(400).json({ message: "Invalid verification session" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${verificationId}))`);
    const [challenge] = await tx
      .select()
      .from(phoneVerificationChallengesTable)
      .where(
        and(
          eq(phoneVerificationChallengesTable.id, verificationId),
          eq(phoneVerificationChallengesTable.statusTokenHash, hashVerificationValue(statusToken)),
        ),
      )
      .limit(1);
    if (!challenge) return { state: "failed" as const, errorCode: "VERIFICATION_NOT_FOUND" };

    const now = new Date();
    if (challenge.status === "pending" && challenge.expiresAt <= now) {
      await tx
        .update(phoneVerificationChallengesTable)
        .set({ status: "expired", failureCode: "EXPIRED" })
        .where(eq(phoneVerificationChallengesTable.id, challenge.id));
      return { state: "failed" as const, errorCode: "EXPIRED" };
    }
    if (challenge.status === "failed" || challenge.status === "expired") {
      return { state: "failed" as const, errorCode: challenge.failureCode ?? "UNABLE_TO_VERIFY" };
    }
    if (challenge.status === "pending") return { state: "pending" as const };
    if (!challenge.userId) return { state: "failed" as const, errorCode: "MOBILE_NOT_REGISTERED" };
    if (challenge.sessionIssuedAt) return { state: "verified" as const, session: null };

    const [user] = await tx
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.id, challenge.userId), eq(usersTable.isActive, true)))
      .limit(1);
    if (!user) {
      await tx
        .update(phoneVerificationChallengesTable)
        .set({ status: "failed", failureCode: "ACCOUNT_INACTIVE" })
        .where(eq(phoneVerificationChallengesTable.id, challenge.id));
      return { state: "failed" as const, errorCode: "ACCOUNT_INACTIVE" };
    }

    const token = createOpaqueToken();
    await tx.insert(sessionsTable).values({
      token,
      userId: user.id,
      deviceInfo: challenge.deviceId ? `SIM verified · ${challenge.deviceId}` : "SIM verified · Android",
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    await tx
      .update(phoneVerificationChallengesTable)
      .set({ sessionIssuedAt: now })
      .where(
        and(
          eq(phoneVerificationChallengesTable.id, challenge.id),
          isNull(phoneVerificationChallengesTable.sessionIssuedAt),
        ),
      );
    return { state: "verified" as const, session: { token, user: publicUser(user) }, userId: user.id };
  });

  if (result.state === "verified" && result.session) {
    await recordLoginEvent(result.userId, "otp", false, "SIM verified · Android");
  }
  res.json(result);
}));

// SMS bridge contract. This endpoint accepts only a signed payload from the
// separately deployed/controlled receiver; the mobile client cannot call it
// as a substitute for an incoming SMS.
router.post("/auth/sms-verification", asyncHandler(async (req, res) => {
  const { senderNumber, message, receivedAt, gatewayMessageId, signature } = req.body ?? {};
  if (
    typeof senderNumber !== "string" ||
    typeof message !== "string" ||
    typeof receivedAt !== "string" ||
    typeof gatewayMessageId !== "string" ||
    typeof signature !== "string"
  ) {
    res.status(400).json({ message: "Invalid SMS bridge payload" });
    return;
  }
  if (!verifyBridgeSignature({ senderNumber, message, receivedAt, gatewayMessageId }, signature)) {
    res.status(401).json({ message: "Invalid bridge signature" });
    return;
  }
  if (!isBridgeTimestampFresh(receivedAt)) {
    res.status(401).json({ message: "Stale bridge message" });
    return;
  }
  const sender = e164(senderNumber);
  const challenge = extractPhoneChallenge(message);
  if (!sender || !challenge || gatewayMessageId.trim().length > 200) {
    res.status(400).json({ message: "Invalid SMS verification message" });
    return;
  }
  const throttled = bridgeThrottle(req, sender.value);
  if (throttled) {
    res.status(429).json({ message: throttled });
    return;
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${hashVerificationValue(challenge)}))`);
    const [event] = await tx
      .insert(smsVerificationEventsTable)
      .values({
        gatewayMessageId: gatewayMessageId.trim(),
        senderNumber: sender.value,
        receivedAt: new Date(receivedAt),
      })
      .onConflictDoNothing({ target: smsVerificationEventsTable.gatewayMessageId })
      .returning({ id: smsVerificationEventsTable.id });
    if (!event) return { verified: false as const, errorCode: "MESSAGE_ALREADY_PROCESSED" };

    const [pending] = await tx
      .select()
      .from(phoneVerificationChallengesTable)
      .where(
        and(
          eq(phoneVerificationChallengesTable.challengeHash, hashVerificationValue(challenge)),
          eq(phoneVerificationChallengesTable.status, "pending"),
        ),
      )
      .limit(1);
    if (!pending) return { verified: false as const, errorCode: "CHALLENGE_INVALID_OR_USED" };
    if (pending.expiresAt <= new Date()) {
      await tx
        .update(phoneVerificationChallengesTable)
        .set({ status: "expired", failureCode: "EXPIRED", attemptCount: sql`${phoneVerificationChallengesTable.attemptCount} + 1` })
        .where(eq(phoneVerificationChallengesTable.id, pending.id));
      return { verified: false as const, errorCode: "EXPIRED" };
    }
    if (pending.phoneNumber !== sender.value) {
      const attempts = pending.attemptCount + 1;
      await tx
        .update(phoneVerificationChallengesTable)
        .set({
          attemptCount: attempts,
          ...(attempts >= 5 ? { status: "failed", failureCode: "SENDER_MISMATCH" } : {}),
        })
        .where(eq(phoneVerificationChallengesTable.id, pending.id));
      return { verified: false as const, errorCode: "SENDER_MISMATCH" };
    }
    if (!pending.userId) {
      await tx
        .update(phoneVerificationChallengesTable)
        .set({ status: "failed", failureCode: "MOBILE_NOT_REGISTERED", attemptCount: pending.attemptCount + 1 })
        .where(eq(phoneVerificationChallengesTable.id, pending.id));
      return { verified: false as const, errorCode: "MOBILE_NOT_REGISTERED", verificationId: pending.id };
    }
    const [user] = await tx
      .select({ id: usersTable.id, isActive: usersTable.isActive })
      .from(usersTable)
      .where(eq(usersTable.id, pending.userId))
      .limit(1);
    if (!user?.isActive) {
      await tx
        .update(phoneVerificationChallengesTable)
        .set({ status: "failed", failureCode: "ACCOUNT_INACTIVE", attemptCount: pending.attemptCount + 1 })
        .where(eq(phoneVerificationChallengesTable.id, pending.id));
      return { verified: false as const, errorCode: "ACCOUNT_INACTIVE", verificationId: pending.id };
    }
    await tx
      .update(phoneVerificationChallengesTable)
      .set({ status: "verified", verifiedAt: new Date(), attemptCount: pending.attemptCount + 1 })
      .where(
        and(
          eq(phoneVerificationChallengesTable.id, pending.id),
          eq(phoneVerificationChallengesTable.status, "pending"),
        ),
      );
    return { verified: true as const, userId: user.id, verificationId: pending.id };
  });

  res.status(result.verified ? 200 : 400).json(result);
}));

// A device key may only be enrolled after a recent successful SIM
// verification for this exact user and device identifier.
router.post("/auth/devices/register", requireAuth, asyncHandler(async (req, res) => {
  const me = (req as AuthedRequest).user;
  const { deviceId, publicKey, algorithm } = req.body ?? {};
  if (!validDeviceId(deviceId) || !validPublicKey(publicKey) || algorithm !== "RSA-SHA256") {
    res.status(400).json({ message: "A valid deviceId, RSA publicKey and algorithm are required" });
    return;
  }
  const recent = await db
    .select({ id: phoneVerificationChallengesTable.id })
    .from(phoneVerificationChallengesTable)
    .where(
      and(
        eq(phoneVerificationChallengesTable.userId, me.id),
        eq(phoneVerificationChallengesTable.deviceId, deviceId.trim()),
        eq(phoneVerificationChallengesTable.status, "verified"),
        gt(phoneVerificationChallengesTable.verifiedAt, new Date(Date.now() - 10 * 60 * 1000)),
      ),
    )
    .orderBy(desc(phoneVerificationChallengesTable.verifiedAt))
    .limit(1);
  if (!recent[0]) {
    res.status(403).json({ message: "Complete SIM verification on this device before registering its key.", code: "SIM_VERIFICATION_REQUIRED" });
    return;
  }
  const [device] = await db
    .insert(userDevicesTable)
    .values({
      userId: me.id,
      deviceId: deviceId.trim(),
      publicKey: publicKey.trim(),
      algorithm,
      isRevoked: false,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: [userDevicesTable.userId, userDevicesTable.deviceId],
      set: { publicKey: publicKey.trim(), algorithm, isRevoked: false, revokedAt: null },
    })
    .returning();
  res.json({
    device: {
      id: device.id,
      deviceId: device.deviceId,
      algorithm: device.algorithm,
      createdAt: device.createdAt.toISOString(),
      lastUsedAt: device.lastUsedAt?.toISOString() ?? null,
    },
  });
}));

router.get("/auth/devices", requireAuth, asyncHandler(async (req, res) => {
  const me = (req as AuthedRequest).user;
  const devices = await db
    .select()
    .from(userDevicesTable)
    .where(and(eq(userDevicesTable.userId, me.id), eq(userDevicesTable.isRevoked, false)))
    .orderBy(desc(userDevicesTable.createdAt));
  res.json({
    devices: devices.map((d) => ({
      id: d.id,
      deviceId: d.deviceId,
      algorithm: d.algorithm,
      createdAt: d.createdAt.toISOString(),
      lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
    })),
  });
}));

router.delete("/auth/devices/:id", requireAuth, asyncHandler(async (req, res) => {
  const me = (req as AuthedRequest).user;
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(404).json({ message: "Device not found" });
    return;
  }
  const [revoked] = await db
    .update(userDevicesTable)
    .set({ isRevoked: true, revokedAt: new Date() })
    .where(and(eq(userDevicesTable.id, id), eq(userDevicesTable.userId, me.id), eq(userDevicesTable.isRevoked, false)))
    .returning({ id: userDevicesTable.id });
  if (!revoked) {
    res.status(404).json({ message: "Device not found" });
    return;
  }
  res.json({ message: "Device revoked" });
}));

// Future passwordless login using the device private key. The challenge is
// short-lived and the signature is checked against the stored public key.
router.post("/auth/device/challenge", asyncHandler(async (req, res) => {
  const { mobile: rawMobile, deviceId } = req.body ?? {};
  if (typeof rawMobile !== "string" || !validDeviceId(deviceId)) {
    res.status(400).json({ message: "Mobile number and deviceId are required" });
    return;
  }
  const phone = e164(rawMobile);
  if (!phone) {
    res.status(400).json({ message: "A valid Indian mobile number is required" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(and(eq(usersTable.mobile, phone.local), eq(usersTable.isActive, true))).limit(1);
  if (!user) {
    res.status(404).json({ message: "Mobile number not registered" });
    return;
  }
  const [device] = await db
    .select()
    .from(userDevicesTable)
    .where(and(eq(userDevicesTable.userId, user.id), eq(userDevicesTable.deviceId, deviceId.trim()), eq(userDevicesTable.isRevoked, false)))
    .limit(1);
  if (!device) {
    res.status(404).json({ message: "Device is not registered" });
    return;
  }
  const challenge = createPhoneChallenge();
  const [created] = await db
    .insert(deviceAuthChallengesTable)
    .values({
      userId: user.id,
      deviceId: device.deviceId,
      challengeHash: hashVerificationValue(challenge),
      expiresAt: new Date(Date.now() + DEVICE_AUTH_CHALLENGE_TTL_MS),
    })
    .returning({ id: deviceAuthChallengesTable.id, expiresAt: deviceAuthChallengesTable.expiresAt });
  res.json({ challengeId: created.id, challenge, expiresAt: created.expiresAt.toISOString() });
}));

router.post("/auth/device/authenticate", asyncHandler(async (req, res) => {
  const { challengeId, challenge: rawChallenge, deviceId, signature, rememberMe, device: deviceInfo } = req.body ?? {};
  if (
    !UUID_RE.test(String(challengeId ?? "")) ||
    typeof rawChallenge !== "string" ||
    !/^AVP-[a-f0-9]{64}$/i.test(rawChallenge) ||
    !validDeviceId(deviceId) ||
    typeof signature !== "string" ||
    signature.length > 0x4000
  ) {
    res.status(400).json({ message: "Invalid device authentication request" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${challengeId}))`);
    const [challenge] = await tx
      .select()
      .from(deviceAuthChallengesTable)
      .where(and(eq(deviceAuthChallengesTable.id, challengeId), eq(deviceAuthChallengesTable.deviceId, deviceId.trim()), isNull(deviceAuthChallengesTable.consumedAt)))
      .limit(1);
    if (!challenge || challenge.expiresAt <= new Date()) return null;
    const [deviceKey] = await tx
      .select()
      .from(userDevicesTable)
      .where(and(eq(userDevicesTable.userId, challenge.userId), eq(userDevicesTable.deviceId, deviceId.trim()), eq(userDevicesTable.isRevoked, false)))
      .limit(1);
    if (
      !deviceKey ||
      challenge.challengeHash !== hashVerificationValue(rawChallenge) ||
      !verifyDeviceSignature(deviceKey.publicKey, rawChallenge, signature)
    ) return null;
    await tx.update(deviceAuthChallengesTable).set({ consumedAt: new Date() }).where(and(eq(deviceAuthChallengesTable.id, challenge.id), isNull(deviceAuthChallengesTable.consumedAt)));
    await tx.update(userDevicesTable).set({ lastUsedAt: new Date() }).where(eq(userDevicesTable.id, deviceKey.id));
    const [user] = await tx.select().from(usersTable).where(and(eq(usersTable.id, challenge.userId), eq(usersTable.isActive, true))).limit(1);
    if (!user) return null;
    const token = createOpaqueToken();
    await tx.insert(sessionsTable).values({
      token,
      userId: user.id,
      deviceInfo: typeof deviceInfo === "string" ? deviceInfo.trim().slice(0, 120) : `Device key · ${deviceId.trim()}`,
      expiresAt: new Date(Date.now() + (rememberMe === true ? 30 * 24 * 60 * 60 * 1000 : SESSION_TTL_MS)),
    });
    return { token, user };
  });
  if (!result) {
    res.status(401).json({ message: "Device verification failed or expired" });
    return;
  }
  await recordLoginEvent(result.user.id, "device_key", rememberMe === true, typeof deviceInfo === "string" ? deviceInfo : `Device key · ${deviceId.trim()}`);
  res.json({ token: result.token, user: publicUser(result.user) });
}));

export default router;