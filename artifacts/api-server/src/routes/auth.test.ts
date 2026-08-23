// Integration tests for the auth routes, run against the real dev database.
// Email delivery and MSG91 provider are mocked — no real network calls.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, or } from "drizzle-orm";
import {
  db,
  loginEventsTable,
  otpCodesTable,
  pool,
  sessionsTable,
  usersTable,
} from "@workspace/db";

vi.mock("../lib/mailer", () => ({
  sendOtpEmail: vi.fn(async () => {}),
  getMailFrom: () => "test@example.com",
  warnIfMailFromUnset: () => {},
}));

type Msg91Result = { ok: true } | { ok: false; reason: string };

// Mock MSG91 provider — default to success so individual tests can override.
// Typed as vi.Mock to allow mockResolvedValueOnce calls without type errors.
const mockMsg91Send = vi.fn(async (_mobile: string): Promise<Msg91Result> => ({ ok: true }));
const mockMsg91Verify = vi.fn(async (_mobile: string, _code: string): Promise<Msg91Result> => ({ ok: true }));
const mockMsg91Retry = vi.fn(async (_mobile: string): Promise<Msg91Result> => ({ ok: true }));
const mockNormalise = vi.fn((raw: string): string | null => {
  // Keep real normalisation logic so format tests work correctly.
  const s = raw.trim();
  if (/^\+91\d{10}$/.test(s)) return s.slice(3);
  if (/^91\d{10}$/.test(s)) return s.slice(2);
  if (/^\d{10}$/.test(s)) return s;
  return null;
});

vi.mock("../lib/msg91", () => ({
  msg91SendOtp: (mobile: string) => mockMsg91Send(mobile),
  msg91VerifyOtp: (mobile: string, code: string) => mockMsg91Verify(mobile, code),
  msg91RetryOtp: (mobile: string) => mockMsg91Retry(mobile),
  normaliseIndianMobile: (raw: string) => mockNormalise(raw),
}));

const { default: app } = await import("../app");
const { hashPassword } = await import("../lib/authUtils");

// Unique-per-run identifiers so parallel/repeated runs never collide.
const RUN = Date.now().toString().slice(-9);
const EMAIL = `authtest-${RUN}@example.test`;
const MOBILE = `9${RUN}`; // 10 digits
const PASSWORD = "Test1234!";

let userId: string;
let inactiveUserId: string;
let providerFailureUserId: string;
const PROVIDER_FAILURE_MOBILE = `7${RUN}`;

beforeAll(async () => {
  const [u] = await db
    .insert(usersTable)
    .values({
      name: "Auth Test User",
      email: EMAIL,
      mobile: MOBILE,
      passwordHash: hashPassword(PASSWORD),
      role: "dealer",
      isActive: true,
    })
    .returning();
  userId = u.id;

  // Inactive user for negative tests
  const INACTIVE_MOBILE = `8${RUN}`;
  const [inactive] = await db
    .insert(usersTable)
    .values({
      name: "Inactive Test User",
      email: `inactive-${RUN}@example.test`,
      mobile: INACTIVE_MOBILE,
      passwordHash: hashPassword(PASSWORD),
      role: "dealer",
      isActive: false,
    })
    .returning();
  inactiveUserId = inactive.id;

  const [providerFailureUser] = await db
    .insert(usersTable)
    .values({
      name: "Provider Failure Test User",
      email: `provider-failure-${RUN}@example.test`,
      mobile: PROVIDER_FAILURE_MOBILE,
      passwordHash: hashPassword(PASSWORD),
      role: "dealer",
      isActive: true,
    })
    .returning();
  providerFailureUserId = providerFailureUser.id;
});

afterAll(async () => {
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, inactiveUserId));
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, providerFailureUserId));
  await db.delete(loginEventsTable).where(eq(loginEventsTable.userId, userId));
  await db.delete(loginEventsTable).where(eq(loginEventsTable.userId, inactiveUserId));
  await db.delete(loginEventsTable).where(eq(loginEventsTable.userId, providerFailureUserId));
  await db
    .delete(otpCodesTable)
    .where(or(eq(otpCodesTable.identifier, EMAIL), eq(otpCodesTable.identifier, MOBILE)));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(usersTable).where(eq(usersTable.id, inactiveUserId));
  await db.delete(usersTable).where(eq(usersTable.id, providerFailureUserId));
  await pool.end();
});

// ── Email + password login ────────────────────────────────────────────────
describe("POST /api/auth/login", () => {
  it("succeeds with correct credentials and returns token + user", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ emailOrMobile: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(20);
    expect(res.body.user.email).toBe(EMAIL);
    // Password hash must never leak
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a wrong password with a clear message", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ emailOrMobile: EMAIL, password: "WrongPass1" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid credentials");
  });

  it("rejects an unknown user with the same generic message", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ emailOrMobile: `nobody-${RUN}@example.test`, password: "Whatever1" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid credentials");
  });

  it("rejects missing fields with 400 and a message", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(400);
    expect(typeof res.body.message).toBe("string");
  });
});

// ── OTP request ───────────────────────────────────────────────────────────
describe("POST /api/auth/otp/request", () => {
  it("returns generic 200 and calls MSG91 send for an existing active user", async () => {
    mockMsg91Send.mockClear();
    mockMsg91Send.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: MOBILE });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if this mobile/i);
    await vi.waitFor(() => expect(mockMsg91Send).toHaveBeenCalledWith(MOBILE));
    expect(mockMsg91Send).toHaveBeenCalledWith(MOBILE);
  });

  it("returns the same generic 200 for an unknown mobile (no MSG91 call)", async () => {
    mockMsg91Send.mockClear();
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: "1234567890" }); // not in DB
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if this mobile/i);
    // Give the async fire-and-forget a tick to settle, then assert no call
    await new Promise((r) => setTimeout(r, 10));
    expect(mockMsg91Send).not.toHaveBeenCalled();
  });

  it("returns generic 200 for an inactive user without calling MSG91", async () => {
    const INACTIVE_MOBILE = `8${RUN}`;
    mockMsg91Send.mockClear();
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: INACTIVE_MOBILE });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if this mobile/i);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockMsg91Send).not.toHaveBeenCalled();
  });

  it("accepts +91-prefixed mobile and normalises to 10 digits for DB lookup", async () => {
    mockMsg91Send.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: `+91${MOBILE}` });
    expect(res.status).toBe(200);
  });

  it("accepts 91-prefixed 12-digit mobile", async () => {
    mockMsg91Send.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: `91${MOBILE}` });
    expect(res.status).toBe(200);
  });

  it("rejects an invalid mobile format with 400", async () => {
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: "not-a-number" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/valid Indian mobile/i);
  });

  it("still returns 200 when MSG91 send fails (provider failure never leaks)", async () => {
    mockMsg91Send.mockResolvedValueOnce({ ok: false, reason: "MSG91 down" });
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: PROVIDER_FAILURE_MOBILE });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if this mobile/i);
  });
});

// ── OTP resend ────────────────────────────────────────────────────────────
describe("POST /api/auth/otp/resend", () => {
  it("returns generic 200 and calls MSG91 retry for an existing active user", async () => {
    mockMsg91Retry.mockClear();
    mockMsg91Retry.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/resend")
      .send({ mobile: MOBILE });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if this mobile/i);
    await vi.waitFor(() => expect(mockMsg91Retry).toHaveBeenCalledWith(MOBILE));
    expect(mockMsg91Retry).toHaveBeenCalledWith(MOBILE);
  });

  it("returns the same generic 200 for an unknown mobile (no MSG91 call)", async () => {
    mockMsg91Retry.mockClear();
    const res = await request(app)
      .post("/api/auth/otp/resend")
      .send({ mobile: "0987654321" }); // not in DB
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockMsg91Retry).not.toHaveBeenCalled();
  });

  it("still returns 200 when MSG91 retry fails", async () => {
    mockMsg91Retry.mockResolvedValueOnce({ ok: false, reason: "expired session" });
    const res = await request(app)
      .post("/api/auth/otp/resend")
      .send({ mobile: MOBILE });
    expect(res.status).toBe(200);
  });

  it("rejects an invalid mobile format with 400", async () => {
    const res = await request(app)
      .post("/api/auth/otp/resend")
      .send({ mobile: "bad" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/valid Indian mobile/i);
  });

  it("returns 429 after exceeding resend rate limit", async () => {
    // Unique mobile to avoid polluting state from other tests.
    const throttleMobile = `5${RUN}`;
    // Insert the user so it proceeds past the DB check to rate-limiting
    const [tUser] = await db
      .insert(usersTable)
      .values({
        name: "Throttle Test",
        email: `throttle-${RUN}@example.test`,
        mobile: throttleMobile,
        passwordHash: hashPassword(PASSWORD),
        role: "dealer",
        isActive: true,
      })
      .returning();

    mockMsg91Retry.mockResolvedValue({ ok: true });
    let last: request.Response | undefined;
    // Resend limit is 2 per 15-min window; send 4 to guarantee hitting it.
    for (let i = 0; i < 4; i++) {
      last = await request(app)
        .post("/api/auth/otp/resend")
        .send({ mobile: throttleMobile });
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect(last!.body.message).toMatch(/too many resend/i);

    await db.delete(usersTable).where(eq(usersTable.id, tUser.id));
  });
});

// ── OTP verify ────────────────────────────────────────────────────────────
describe("POST /api/auth/otp/verify", () => {
  it("issues a session when MSG91 approves the code for an active user", async () => {
    mockMsg91Verify.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: MOBILE, code: "123456" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(20);
    expect(res.body.user.mobile).toBe(MOBILE);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects when MSG91 says the code is wrong (no session issued)", async () => {
    mockMsg91Verify.mockResolvedValueOnce({ ok: false, reason: "OTP not matched" });
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: MOBILE, code: "000000" });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/incorrect or expired/i);
    expect(res.body.token).toBeUndefined();
  });

  it("rejects for an inactive user even when MSG91 approves", async () => {
    const INACTIVE_MOBILE = `8${RUN}`;
    mockMsg91Verify.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: INACTIVE_MOBILE, code: "123456" });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/account not found or inactive/i);
    expect(res.body.token).toBeUndefined();
  });

  it("rejects for an unknown mobile even when MSG91 approves", async () => {
    mockMsg91Verify.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: "5555555555", code: "123456" });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/account not found or inactive/i);
    expect(res.body.token).toBeUndefined();
  });

  it("accepts +91-prefixed mobile in verify", async () => {
    mockMsg91Verify.mockClear();
    mockMsg91Verify.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: `+91${MOBILE}`, code: "123456" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(mockMsg91Verify).toHaveBeenCalledWith(MOBILE, "123456");
  });

  it("locks out after repeated wrong codes (server-side throttle)", async () => {
    // Use a fresh unique mobile with an active user to isolate lockout state.
    const lockMobile = `6${RUN}`;
    const [lUser] = await db
      .insert(usersTable)
      .values({
        name: "Lockout Test",
        email: `lockout-${RUN}@example.test`,
        mobile: lockMobile,
        passwordHash: hashPassword(PASSWORD),
        role: "dealer",
        isActive: true,
      })
      .returning();

    mockMsg91Verify.mockResolvedValue({ ok: false, reason: "OTP not matched" });
    let last: request.Response | undefined;
    for (let i = 0; i < 7; i++) {
      last = await request(app)
        .post("/api/auth/otp/verify")
        .send({ mobile: lockMobile, code: "000000" });
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect(last!.body.message).toMatch(/too many incorrect attempts/i);

    await db.delete(usersTable).where(eq(usersTable.id, lUser.id));
  });

  it("does not issue a session when MSG91 call throws (provider error)", async () => {
    mockMsg91Verify.mockRejectedValueOnce(new Error("MSG91 network error"));
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: MOBILE, code: "123456" });
    // Should not succeed; expect 500 (unhandled) or 401, not 200
    expect(res.status).not.toBe(200);
    expect(res.body.token).toBeUndefined();
  });

  it("rejects missing fields with 400", async () => {
    const res = await request(app).post("/api/auth/otp/verify").send({});
    expect(res.status).toBe(400);
    expect(typeof res.body.message).toBe("string");
  });

  it("rejects invalid mobile format with 400", async () => {
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: "not-a-number", code: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/valid Indian mobile/i);
  });
});

// ── Forgot password flow ──────────────────────────────────────────────────
describe("forgot password flow", () => {
  it("verifies a reset code, resets the password, and rejects reset-token reuse", async () => {
    const { createOtp } = await import("../lib/authUtils");
    const code = await createOtp(EMAIL, "reset", null);

    const verify = await request(app)
      .post("/api/auth/forgot/verify")
      .send({ email: EMAIL, code });
    expect(verify.status).toBe(200);
    const resetToken: string = verify.body.resetToken;
    expect(typeof resetToken).toBe("string");

    const newPassword = "NewPass123";
    const reset = await request(app)
      .post("/api/auth/forgot/reset")
      .send({ email: EMAIL, resetToken, newPassword });
    expect(reset.status).toBe(200);

    // New password works
    const login = await request(app)
      .post("/api/auth/login")
      .send({ emailOrMobile: EMAIL, password: newPassword });
    expect(login.status).toBe(200);

    // Reusing the same reset token must fail
    const reuse = await request(app)
      .post("/api/auth/forgot/reset")
      .send({ email: EMAIL, resetToken, newPassword: "Another123" });
    expect(reuse.status).toBe(401);
    expect(reuse.body.message).toMatch(/reset session expired/i);

    // ...and the password was NOT changed by the reused token
    const stillWorks = await request(app)
      .post("/api/auth/login")
      .send({ emailOrMobile: EMAIL, password: newPassword });
    expect(stillWorks.status).toBe(200);
  });

  it("rejects a reused OTP code on forgot/verify", async () => {
    const { createOtp } = await import("../lib/authUtils");
    const code = await createOtp(EMAIL, "reset", null);
    const first = await request(app)
      .post("/api/auth/forgot/verify")
      .send({ email: EMAIL, code });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post("/api/auth/forgot/verify")
      .send({ email: EMAIL, code });
    expect(second.status).toBe(401);
    expect(second.body.message).toMatch(/expired or not found/i);
  });

  it("rejects a weak new password with a descriptive message", async () => {
    const res = await request(app)
      .post("/api/auth/forgot/reset")
      .send({ email: EMAIL, resetToken: "irrelevant", newPassword: "short" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8\+ characters/);
  });
});

// Runs LAST: repeated failures lock the account and the client IP,
// which would poison earlier login tests if run first.
describe("login rate limiting", () => {
  it("returns 429 with a retry-after message after repeated failures", async () => {
    const target = `locked-${RUN}@example.test`;
    let last: request.Response | undefined;
    for (let i = 0; i < 7; i++) {
      last = await request(app)
        .post("/api/auth/login")
        .send({ emailOrMobile: target, password: "BadPass1" });
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect(last!.body.message).toMatch(/too many failed attempts.*try again in/i);
  });
});
