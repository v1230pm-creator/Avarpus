import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import {
  db,
  loginEventsTable,
  otpCodesTable,
  otpVerificationRateLimitsTable,
  sessionsTable,
  trustedDeviceRecoveryRateLimitsTable,
  trustedDeviceTrustsTable,
  usersTable,
} from "@workspace/db";
import type { DbUser } from "@workspace/db";
import { desc } from "drizzle-orm";

// Persistent sessions remain valid until they are explicitly revoked. The
// database keeps a non-null expiry for efficient active-session queries.
const PERSISTENT_SESSION_EXPIRES_AT = new Date("9999-12-31T23:59:59.999Z");
const SESSION_TTL_DEFAULT_MS = 24 * 60 * 60 * 1000; // 1 day
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;
export const TRUSTED_DEVICE_SESSION_MAX_MS = 48 * 60 * 60 * 1000;
export const TRUSTED_DEVICE_RECOVERY_MS = 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string | null): boolean {
  return typeof hash === "string" && bcrypt.compareSync(password, hash);
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function generateToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export async function createSession(
  userId: string,
  rememberMe = false,
  deviceInfo?: string | null,
  options?: { expiresAt?: Date; trustedDeviceId?: string | null },
): Promise<string> {
  const token = generateToken();
  const expiresAt = options?.expiresAt ??
    (rememberMe
      ? PERSISTENT_SESSION_EXPIRES_AT
      : new Date(Date.now() + SESSION_TTL_DEFAULT_MS));
  await db.insert(sessionsTable).values({
    token,
    userId,
    deviceInfo: deviceInfo ?? null,
    trustedDeviceId: options?.trustedDeviceId ?? null,
    expiresAt,
  });
  return token;
}

export async function recordLoginEvent(
  userId: string,
  method: "password" | "otp" | "device_key" | "trusted_device",
  rememberMe: boolean,
  deviceInfo?: string | null,
): Promise<void> {
  await db.insert(loginEventsTable).values({
    userId,
    method,
    rememberMe,
    deviceInfo: deviceInfo ?? null,
  });
}

export function hashAndroidDeviceIdentifier(identifier: string): string {
  return sha256(identifier);
}

// ANDROID_ID is a 64-bit hexadecimal value. Do not broaden this validator to
// accept MAC addresses, IMEIs, serials, SIM values, or arbitrary install IDs.
export function isValidAndroidDeviceIdentifier(identifier: unknown): identifier is string {
  return typeof identifier === "string" && /^[a-fA-F0-9]{16}$/.test(identifier);
}

export async function enrollTrustedDevice(
  userId: string,
  androidIdHash: string,
  deviceInfo: string | null,
  enrolledAt = new Date(),
) {
  const expiresAt = new Date(enrolledAt.getTime() + TRUSTED_DEVICE_SESSION_MAX_MS);
  const recoveryDeadline = new Date(enrolledAt.getTime() + TRUSTED_DEVICE_RECOVERY_MS);
  return db.transaction(async (tx) => {
    // Global hash lock is outermost in every enrollment/recovery path. It
    // makes exact-one recovery decisions stable while another account enrolls
    // the same (hashed) Android ID.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trusted-device-hash:${androidIdHash}`}))`);
    // Serializes same-user rotations even when no previous generation exists.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trusted-device:${userId}:${androidIdHash}`}))`);
    const candidates = await tx
      .select({ id: trustedDeviceTrustsTable.id })
      .from(trustedDeviceTrustsTable)
      .where(and(
        eq(trustedDeviceTrustsTable.userId, userId),
        eq(trustedDeviceTrustsTable.androidIdHash, androidIdHash),
        isNull(trustedDeviceTrustsTable.revokedAt),
      ));
    const candidateIds = candidates.map((row) => row.id).sort();
    for (const id of candidateIds) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trusted-device-generation:${id}`}))`);
    }
    const oldGenerations = candidateIds.length
      ? await tx
        .select({ id: trustedDeviceTrustsTable.id })
        .from(trustedDeviceTrustsTable)
        .where(and(
          eq(trustedDeviceTrustsTable.userId, userId),
          eq(trustedDeviceTrustsTable.androidIdHash, androidIdHash),
          isNull(trustedDeviceTrustsTable.revokedAt),
        ))
        .for("update")
      : [];
    if (oldGenerations.length) {
      const ids = oldGenerations.map((row) => row.id);
      // Remove every old linked session before revoking old immutable generations.
      await tx.delete(sessionsTable).where(inArray(sessionsTable.trustedDeviceId, ids));
      await tx
        .update(trustedDeviceTrustsTable)
        .set({ revokedAt: enrolledAt })
        .where(inArray(trustedDeviceTrustsTable.id, ids));
    }
    const [trust] = await tx
      .insert(trustedDeviceTrustsTable)
      .values({ userId, androidIdHash, deviceInfo, expiresAt, recoveryDeadline })
      .returning();
    return trust;
  });
}

// Locks the immutable generation and replaces—not extends—its session.
export async function recoverTrustedDeviceSession(androidIdHash: string) {
  return db.transaction(async (tx) => {
    const now = new Date();
    // Must precede the generation lock: enrollment takes this same outer lock
    // before its user/device and generation locks.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trusted-device-hash:${androidIdHash}`}))`);
    const candidates = await tx
      .select({ trust: trustedDeviceTrustsTable, user: usersTable })
      .from(trustedDeviceTrustsTable)
      .innerJoin(usersTable, eq(trustedDeviceTrustsTable.userId, usersTable.id))
      .where(and(
        eq(trustedDeviceTrustsTable.androidIdHash, androidIdHash),
        isNull(trustedDeviceTrustsTable.revokedAt),
        gt(trustedDeviceTrustsTable.expiresAt, now),
        gt(trustedDeviceTrustsTable.recoveryDeadline, now),
        eq(usersTable.isActive, true),
      ))
      .limit(2);
    if (candidates.length !== 1) return null;
    const candidate = candidates[0];
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trusted-device-generation:${candidate.trust.id}`}))`);
    const matches = await tx
      .select({ trust: trustedDeviceTrustsTable, user: usersTable })
      .from(trustedDeviceTrustsTable)
      .innerJoin(usersTable, eq(trustedDeviceTrustsTable.userId, usersTable.id))
      .where(and(
        eq(trustedDeviceTrustsTable.id, candidate.trust.id),
        isNull(trustedDeviceTrustsTable.revokedAt),
        gt(trustedDeviceTrustsTable.expiresAt, now),
        gt(trustedDeviceTrustsTable.recoveryDeadline, now),
        eq(usersTable.isActive, true),
      ))
      .limit(1)
      .for("update");
    if (matches.length !== 1) return null;
    const { trust, user } = matches[0];
    await tx.delete(sessionsTable).where(eq(sessionsTable.trustedDeviceId, trust.id));
    const token = generateToken();
    await tx.insert(sessionsTable).values({
      token,
      userId: user.id,
      deviceInfo: trust.deviceInfo,
      trustedDeviceId: trust.id,
      expiresAt: trust.recoveryDeadline,
    });
    return { token, trust, user };
  });
}

const TRUSTED_RECOVERY_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const TRUSTED_RECOVERY_LIMIT_PER_IP = 20;
const TRUSTED_RECOVERY_LIMIT_PER_DEVICE = 5;

async function consumeTrustedRecoveryLimit(keyHash: string, maxAttempts: number) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trusted-recovery-limit:${keyHash}`}))`);
    const now = new Date();
    const [row] = await tx
      .select()
      .from(trustedDeviceRecoveryRateLimitsTable)
      .where(eq(trustedDeviceRecoveryRateLimitsTable.keyHash, keyHash))
      .for("update");
    if (!row || row.expiresAt <= now) {
      await tx
        .insert(trustedDeviceRecoveryRateLimitsTable)
        .values({
          keyHash,
          attemptCount: 1,
          windowStartedAt: now,
          expiresAt: new Date(now.getTime() + TRUSTED_RECOVERY_LIMIT_WINDOW_MS),
        })
        .onConflictDoUpdate({
          target: trustedDeviceRecoveryRateLimitsTable.keyHash,
          set: {
            attemptCount: 1,
            windowStartedAt: now,
            expiresAt: new Date(now.getTime() + TRUSTED_RECOVERY_LIMIT_WINDOW_MS),
            updatedAt: now,
          },
        });
      return { limited: false, retryAfterMs: 0 };
    }
    const retryAfterMs = Math.max(0, row.expiresAt.getTime() - now.getTime());
    if (row.attemptCount >= maxAttempts) return { limited: true, retryAfterMs };
    await tx
      .update(trustedDeviceRecoveryRateLimitsTable)
      .set({ attemptCount: row.attemptCount + 1, updatedAt: now })
      .where(eq(trustedDeviceRecoveryRateLimitsTable.keyHash, keyHash));
    return { limited: false, retryAfterMs: 0 };
  });
}

export async function checkTrustedDeviceRecoveryLimit(ip: string, androidIdHash: string) {
  // Both lookup keys are one-way hashes; the device key is additionally
  // namespaced and re-hashed rather than storing even its identifier hash.
  const [byIp, byDevice] = await Promise.all([
    consumeTrustedRecoveryLimit(sha256(`trusted-recovery:ip:${ip}`), TRUSTED_RECOVERY_LIMIT_PER_IP),
    consumeTrustedRecoveryLimit(sha256(`trusted-recovery:device:${androidIdHash}`), TRUSTED_RECOVERY_LIMIT_PER_DEVICE),
  ]);
  return byIp.limited ? byIp : byDevice;
}

export async function revokeTrustedDeviceForSession(token: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select({ trustedDeviceId: sessionsTable.trustedDeviceId })
      .from(sessionsTable)
      .where(eq(sessionsTable.token, token))
      .limit(1);
    if (!session?.trustedDeviceId) return;
    const trustedDeviceId = session.trustedDeviceId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trusted-device-generation:${trustedDeviceId}`}))`);
    await tx.select({ id: trustedDeviceTrustsTable.id }).from(trustedDeviceTrustsTable)
      .where(eq(trustedDeviceTrustsTable.id, trustedDeviceId)).for("update");
    await tx.update(trustedDeviceTrustsTable).set({ revokedAt: new Date() })
      .where(and(eq(trustedDeviceTrustsTable.id, trustedDeviceId), isNull(trustedDeviceTrustsTable.revokedAt)));
    await tx.delete(sessionsTable).where(eq(sessionsTable.trustedDeviceId, trustedDeviceId));
  });
}

export async function getLoginHistory(userId: string, limit = 20) {
  return db
    .select({
      id: loginEventsTable.id,
      method: loginEventsTable.method,
      rememberMe: loginEventsTable.rememberMe,
      deviceInfo: loginEventsTable.deviceInfo,
      createdAt: loginEventsTable.createdAt,
    })
    .from(loginEventsTable)
    .where(eq(loginEventsTable.userId, userId))
    .orderBy(desc(loginEventsTable.createdAt))
    .limit(limit);
}

export async function getSessionUser(token: string): Promise<DbUser | null> {
  const rows = await db
    .select({ user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(
      and(eq(sessionsTable.token, token), gt(sessionsTable.expiresAt, new Date())),
    )
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
}

// Active (non-expired) sessions for a user, newest first. Never returns tokens.
export async function listActiveSessions(userId: string, currentToken: string) {
  const rows = await db
    .select({
      id: sessionsTable.id,
      token: sessionsTable.token,
      deviceInfo: sessionsTable.deviceInfo,
      createdAt: sessionsTable.createdAt,
      expiresAt: sessionsTable.expiresAt,
    })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.userId, userId), gt(sessionsTable.expiresAt, new Date())))
    .orderBy(desc(sessionsTable.createdAt));
  return rows.map((r) => ({
    id: r.id,
    deviceInfo: r.deviceInfo,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    current: r.token === currentToken,
  }));
}

// Revoke one of the user's own sessions by its public id.
// Returns false when no matching session belongs to this user.
export async function revokeSessionById(userId: string, sessionId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const selected = await tx
      .select({ id: sessionsTable.id, trustedDeviceId: sessionsTable.trustedDeviceId })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.userId, userId), eq(sessionsTable.id, sessionId)));
    const ids = selected.flatMap((session) => session.trustedDeviceId ? [session.trustedDeviceId] : []);
    if (ids.length) {
      for (const id of [...new Set(ids)].sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trusted-device-generation:${id}`}))`);
      }
      // Lock the immutable generation before deletion. This serializes with a
      // concurrent recovery and removes any replacement session it produced.
      await tx.select({ id: trustedDeviceTrustsTable.id }).from(trustedDeviceTrustsTable)
        .where(inArray(trustedDeviceTrustsTable.id, ids)).for("update");
      await tx.update(trustedDeviceTrustsTable).set({ revokedAt: new Date() })
        .where(and(inArray(trustedDeviceTrustsTable.id, ids), isNull(trustedDeviceTrustsTable.revokedAt)));
      await tx.delete(sessionsTable).where(inArray(sessionsTable.trustedDeviceId, ids));
    }
    if (selected.some((session) => !session.trustedDeviceId)) {
      await tx.delete(sessionsTable).where(and(eq(sessionsTable.userId, userId), eq(sessionsTable.id, sessionId)));
    }
    return selected.length > 0;
  });
}

// Revoke every session of the user except the current one. Returns count revoked.
export async function revokeOtherSessions(userId: string, currentToken: string): Promise<number> {
  return db.transaction(async (tx) => {
    const selected = await tx
      .select({ id: sessionsTable.id, trustedDeviceId: sessionsTable.trustedDeviceId })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.userId, userId), ne(sessionsTable.token, currentToken)));
    const ids = selected.flatMap((session) => session.trustedDeviceId ? [session.trustedDeviceId] : []);
    if (ids.length) {
      for (const id of [...new Set(ids)].sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trusted-device-generation:${id}`}))`);
      }
      await tx.select({ id: trustedDeviceTrustsTable.id }).from(trustedDeviceTrustsTable)
        .where(inArray(trustedDeviceTrustsTable.id, ids)).for("update");
      await tx.update(trustedDeviceTrustsTable).set({ revokedAt: new Date() })
        .where(and(inArray(trustedDeviceTrustsTable.id, ids), isNull(trustedDeviceTrustsTable.revokedAt)));
      await tx.delete(sessionsTable).where(inArray(sessionsTable.trustedDeviceId, ids));
    }
    const ordinaryIds = selected.filter((session) => !session.trustedDeviceId).map((session) => session.id);
    if (ordinaryIds.length) await tx.delete(sessionsTable).where(inArray(sessionsTable.id, ordinaryIds));
    return selected.length;
  });
}

// Revoke every session of the user (e.g. after a password reset).
export async function revokeAllSessions(userId: string): Promise<number> {
  const deleted = await db
    .delete(sessionsTable)
    .where(eq(sessionsTable.userId, userId))
    .returning({ id: sessionsTable.id });
  return deleted.length;
}

export async function createOtp(
  identifier: string,
  purpose: string,
  payload?: unknown,
): Promise<string> {
  const code = generateOtpCode();
  // Invalidate previous outstanding codes for the same identifier/purpose
  await db
    .delete(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.identifier, identifier),
        eq(otpCodesTable.purpose, purpose),
      ),
    );
  await db.insert(otpCodesTable).values({
    identifier,
    purpose,
    codeHash: sha256(code),
    payload: payload ?? null,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  return code;
}

export async function invalidateOtp(identifier: string, purpose: string): Promise<void> {
  await db
    .delete(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.identifier, identifier),
        eq(otpCodesTable.purpose, purpose),
      ),
    );
}

export type OtpResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: string };

export async function consumeOtp(
  identifier: string,
  purpose: string,
  code: string,
): Promise<OtpResult> {
  const rows = await db
    .select()
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.identifier, identifier),
        eq(otpCodesTable.purpose, purpose),
        isNull(otpCodesTable.consumedAt),
        gt(otpCodesTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: "Code expired or not found. Request a new one." };
  if (row.attempts >= MAX_OTP_ATTEMPTS) {
    return { ok: false, error: "Too many attempts. Request a new code." };
  }
  if (row.codeHash !== sha256(code)) {
    await db
      .update(otpCodesTable)
      .set({ attempts: row.attempts + 1 })
      .where(eq(otpCodesTable.id, row.id));
    return { ok: false, error: "Incorrect code. Please try again." };
  }
  await db
    .update(otpCodesTable)
    .set({ consumedAt: new Date() })
    .where(eq(otpCodesTable.id, row.id));
  return { ok: true, payload: row.payload };
}

// Retention window for login history rows.
const LOGIN_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// Delete expired sessions, expired/consumed OTP codes, expired OTP verification
// rate-limit rows, and old login events.
// Returns counts so callers can log what was pruned.
export async function cleanupExpiredAuthData(): Promise<{
  sessions: number;
  otpCodes: number;
  otpVerificationRateLimits: number;
  loginEvents: number;
  trustedDeviceTrusts: number;
  trustedDeviceRecoveryRateLimits: number;
}> {
  const now = new Date();
  const sessions = await db
    .delete(sessionsTable)
    .where(lt(sessionsTable.expiresAt, now))
    .returning({ id: sessionsTable.id });
  const otpCodes = await db
    .delete(otpCodesTable)
    .where(lt(otpCodesTable.expiresAt, now))
    .returning({ id: otpCodesTable.id });
  const otpVerificationRateLimits = await db
    .delete(otpVerificationRateLimitsTable)
    .where(lt(otpVerificationRateLimitsTable.expiresAt, now))
    .returning({ keyHash: otpVerificationRateLimitsTable.keyHash });
  const loginEvents = await db
    .delete(loginEventsTable)
    .where(lt(loginEventsTable.createdAt, new Date(now.getTime() - LOGIN_EVENT_RETENTION_MS)))
    .returning({ id: loginEventsTable.id });
  const trustedDeviceTrusts = await db
    .delete(trustedDeviceTrustsTable)
    .where(lt(trustedDeviceTrustsTable.expiresAt, now))
    .returning({ id: trustedDeviceTrustsTable.id });
  const trustedDeviceRecoveryRateLimits = await db
    .delete(trustedDeviceRecoveryRateLimitsTable)
    .where(lt(trustedDeviceRecoveryRateLimitsTable.expiresAt, now))
    .returning({ keyHash: trustedDeviceRecoveryRateLimitsTable.keyHash });
  return {
    sessions: sessions.length,
    otpCodes: otpCodes.length,
    otpVerificationRateLimits: otpVerificationRateLimits.length,
    loginEvents: loginEvents.length,
    trustedDeviceTrusts: trustedDeviceTrusts.length,
    trustedDeviceRecoveryRateLimits: trustedDeviceRecoveryRateLimits.length,
  };
}

export function publicUser(u: DbUser) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    mobile: u.mobile,
    role: u.role,
    isActive: u.isActive,
    shopId: u.shopId ?? undefined,
    dealerId: u.dealerId ?? undefined,
    designation: u.designation ?? undefined,
    joinDate: u.joinDate ?? undefined,
    businessName: u.businessName ?? undefined,
    gstNumber: u.gstNumber ?? undefined,
    shopAddress: u.shopAddress ?? undefined,
    profilePhoto: u.profilePhoto ?? undefined,
    profileAbout: u.profileAbout ?? undefined,
    profileUsername: u.profileUsername ?? undefined,
    profileLinks: u.profileLinks ?? undefined,
    companyLogo: u.companyLogo ?? undefined,
    needsDisplayName: u.role === "customer" && u.displayNameCompletedAt === null,
  };
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - 2, 2))}@${domain}`;
}
