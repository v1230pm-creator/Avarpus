// Integration tests for the auth routes, run against the real dev database.
// Email delivery and MSG91 provider are mocked — no real network calls.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, or } from "drizzle-orm";
import {
  db,
  loginEventsTable,
  otpCodesTable,
  otpVerificationRateLimitsTable,
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
const { otpVerificationRateLimitKeyHash } = await import("../lib/rateLimit");

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
  await db
    .delete(otpVerificationRateLimitsTable)
    .where(
      eq(
        otpVerificationRateLimitsTable.keyHash,
        otpVerificationRateLimitKeyHash(`otpverify:${MOBILE}`),
      ),
    );
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(usersTable).where(eq(usersTable.id, inactiveUserId));
  await db.delete(usersTable).where(eq(usersTable.id, providerFailureUserId));
  await pool.end();
});

// ── Retired password routes ───────────────────────────────────────────────
describe("retired password routes", () => {
  it.each([
    "/api/auth/login",
    "/api/auth/forgot/request",
    "/api/auth/forgot/verify",
    "/api/auth/forgot/reset",
    "/api/auth/change-password",
  ])("does not expose %s", async (path) => {
    const res = await request(app).post(path).send({
      emailOrMobile: EMAIL,
      email: EMAIL,
      password: PASSWORD,
      currentPassword: PASSWORD,
      newPassword: "Another123",
    });
    expect(res.status).toBe(404);
    expect(res.body.token).toBeUndefined();
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

    await db
      .delete(otpVerificationRateLimitsTable)
      .where(
        eq(
          otpVerificationRateLimitsTable.keyHash,
          otpVerificationRateLimitKeyHash(`otpverify:${lockMobile}`),
        ),
      );
    await db.delete(usersTable).where(eq(usersTable.id, lUser.id));
  });

  it("honours a lockout written before this API process handled the request", async () => {
    const restartSafeMobile = `4${RUN}`;
    const now = Date.now();
    await db.insert(otpVerificationRateLimitsTable).values({
      keyHash: otpVerificationRateLimitKeyHash(`otpverify:${restartSafeMobile}`),
      failureCount: 5,
      windowStartedAt: new Date(now - 30_000),
      lockedUntil: new Date(now + 60_000),
      expiresAt: new Date(now + 60_000),
    });

    mockMsg91Verify.mockClear();
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: restartSafeMobile, code: "000000" });

    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/too many incorrect attempts/i);
    expect(mockMsg91Verify).not.toHaveBeenCalled();

    await db
      .delete(otpVerificationRateLimitsTable)
      .where(
        eq(
          otpVerificationRateLimitsTable.keyHash,
          otpVerificationRateLimitKeyHash(`otpverify:${restartSafeMobile}`),
        ),
      );
  });

  it("allows one provider call for concurrent wrong-code requests, then locks out durably", async () => {
    const concurrentMobile = `3${RUN}`;
    const [concurrentUser] = await db
      .insert(usersTable)
      .values({
        name: "Concurrent OTP Lockout Test",
        email: `concurrent-otp-${RUN}@example.test`,
        mobile: concurrentMobile,
        passwordHash: hashPassword(PASSWORD),
        role: "dealer",
        isActive: true,
      })
      .returning();

    mockMsg91Verify.mockClear();
    let providerStarted!: () => void;
    const providerStartedPromise = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    let releaseProvider!: () => void;
    const providerReleasePromise = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    mockMsg91Verify.mockImplementation(
      async (): Promise<Msg91Result> => {
        providerStarted();
        await providerReleasePromise;
        return { ok: false, reason: "OTP not matched" };
      },
    );
    const firstAttempt = request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: concurrentMobile, code: "000000" })
      .then((res) => res);
    await providerStartedPromise;
    const busyResponses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/auth/otp/verify")
          .send({ mobile: concurrentMobile, code: "000000" }),
      ),
    );
    releaseProvider();
    const responses = [await firstAttempt, ...busyResponses];

    expect(responses.filter((res) => res.status === 401)).toHaveLength(1);
    expect(responses.filter((res) => res.status === 429)).toHaveLength(5);
    expect(mockMsg91Verify).toHaveBeenCalledTimes(1);
    expect(
      responses.filter((res) => res.status === 429)
        .every((res) => /verification already in progress/i.test(res.body.message)),
    ).toBe(true);

    // Four later attempts complete one at a time, producing the fifth durable
    // failure. The next request is blocked without reaching MSG91.
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post("/api/auth/otp/verify")
        .send({ mobile: concurrentMobile, code: "000000" });
      expect(res.status).toBe(401);
    }
    const locked = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: concurrentMobile, code: "000000" });
    expect(locked.status).toBe(429);
    expect(locked.body.message).toMatch(/too many incorrect attempts/i);
    expect(mockMsg91Verify).toHaveBeenCalledTimes(5);

    await db
      .delete(otpVerificationRateLimitsTable)
      .where(
        eq(
          otpVerificationRateLimitsTable.keyHash,
          otpVerificationRateLimitKeyHash(`otpverify:${concurrentMobile}`),
        ),
      );
    await db.delete(usersTable).where(eq(usersTable.id, concurrentUser.id));
  });

  it("does not start a second MSG91 verification while a delayed one owns the reservation", async () => {
    const delayedMobile = `2${RUN}`;
    const [delayedUser] = await db
      .insert(usersTable)
      .values({
        name: "Delayed OTP Provider Test",
        email: `delayed-otp-${RUN}@example.test`,
        mobile: delayedMobile,
        passwordHash: hashPassword(PASSWORD),
        role: "dealer",
        isActive: true,
      })
      .returning();

    mockMsg91Verify.mockClear();
    let providerStarted!: () => void;
    const providerStartedPromise = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    let releaseProvider!: () => void;
    const releaseProviderPromise = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    mockMsg91Verify.mockImplementation(async (): Promise<Msg91Result> => {
      providerStarted();
      await releaseProviderPromise;
      return { ok: false, reason: "MSG91 verify timed out" };
    });

    const firstAttempt = request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: delayedMobile, code: "000000" })
      .then((res) => res);
    await providerStartedPromise;

    const retryWhilePending = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: delayedMobile, code: "000000" });

    expect(retryWhilePending.status).toBe(429);
    expect(retryWhilePending.body.message).toMatch(/verification already in progress/i);
    expect(mockMsg91Verify).toHaveBeenCalledTimes(1);

    releaseProvider();
    expect((await firstAttempt).status).toBe(401);

    await db
      .delete(otpVerificationRateLimitsTable)
      .where(
        eq(
          otpVerificationRateLimitsTable.keyHash,
          otpVerificationRateLimitKeyHash(`otpverify:${delayedMobile}`),
        ),
      );
    await db.delete(usersTable).where(eq(usersTable.id, delayedUser.id));
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

