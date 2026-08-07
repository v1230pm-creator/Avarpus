import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, lt, isNull, ne } from "drizzle-orm";
import { db, loginEventsTable, otpCodesTable, sessionsTable, usersTable } from "@workspace/db";
import type { DbUser } from "@workspace/db";
import { desc } from "drizzle-orm";

// "Remember me" keeps the session for 30 days; otherwise it lasts 1 day.
const SESSION_TTL_REMEMBERED_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_TTL_DEFAULT_MS = 24 * 60 * 60 * 1000; // 1 day
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
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
): Promise<string> {
  const token = generateToken();
  const ttl = rememberMe ? SESSION_TTL_REMEMBERED_MS : SESSION_TTL_DEFAULT_MS;
  await db.insert(sessionsTable).values({
    token,
    userId,
    deviceInfo: deviceInfo ?? null,
    expiresAt: new Date(Date.now() + ttl),
  });
  return token;
}

export async function recordLoginEvent(
  userId: string,
  method: "password" | "otp",
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
  const deleted = await db
    .delete(sessionsTable)
    .where(and(eq(sessionsTable.userId, userId), eq(sessionsTable.id, sessionId)))
    .returning({ id: sessionsTable.id });
  return deleted.length > 0;
}

// Revoke every session of the user except the current one. Returns count revoked.
export async function revokeOtherSessions(userId: string, currentToken: string): Promise<number> {
  const deleted = await db
    .delete(sessionsTable)
    .where(and(eq(sessionsTable.userId, userId), ne(sessionsTable.token, currentToken)))
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

// Delete expired sessions, expired/consumed OTP codes, and old login events.
// Returns counts so callers can log what was pruned.
export async function cleanupExpiredAuthData(): Promise<{
  sessions: number;
  otpCodes: number;
  loginEvents: number;
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
  const loginEvents = await db
    .delete(loginEventsTable)
    .where(lt(loginEventsTable.createdAt, new Date(now.getTime() - LOGIN_EVENT_RETENTION_MS)))
    .returning({ id: loginEventsTable.id });
  return {
    sessions: sessions.length,
    otpCodes: otpCodes.length,
    loginEvents: loginEvents.length,
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
    designation: u.designation ?? undefined,
    joinDate: u.joinDate ?? undefined,
    businessName: u.businessName ?? undefined,
    gstNumber: u.gstNumber ?? undefined,
    shopAddress: u.shopAddress ?? undefined,
    profilePhoto: u.profilePhoto ?? undefined,
    companyLogo: u.companyLogo ?? undefined,
  };
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - 2, 2))}@${domain}`;
}
