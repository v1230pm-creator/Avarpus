// Integration tests for the auth routes, run against the real dev database.
// Email delivery and Hanu OTP delivery are mocked — no real network calls.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
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

type HanuOtpResult = { ok: true } | { ok: false; reason: string };

// Mock Hanu OTP delivery — default to success so individual tests can override.
// Typed as vi.Mock to allow mockResolvedValueOnce calls without type errors.
const mockHanuSend = vi.fn(
  async (_mobile: string, _code: string): Promise<HanuOtpResult> => ({ ok: true }),
);
let mockHanuConfigured = true;
const mockNormalise = vi.fn((raw: string): string | null => {
  // Keep real normalisation logic so format tests work correctly.
  const s = raw.trim();
  if (/^\+91\d{10}$/.test(s)) return s.slice(3);
  if (/^91\d{10}$/.test(s)) return s.slice(2);
  if (/^\d{10}$/.test(s)) return s;
  return null;
});

vi.mock("../lib/hanuOtp", () => ({
  hanuSendOtp: (mobile: string, code: string) => mockHanuSend(mobile, code),
  getHanuOtpStatus: () => ({
    provider: "Hanu OTP",
    configured: mockHanuConfigured,
    endpoint: "https://api.hanuotp.in/sms-otp.php",
    templateId: mockHanuConfigured ? "template-123" : null,
    apiKeyConfigured: true,
  }),
  normaliseIndianMobile: (raw: string) => mockNormalise(raw),
}));

const { default: app } = await import("../app");
const { createOtp, hashPassword } = await import("../lib/authUtils");
const { otpVerificationRateLimitKeyHash } = await import("../lib/rateLimit");
const openApiSpec = readFileSync(
  new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url),
  "utf8",
);

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

// ── OTP-only authentication contract ─────────────────────────────────────
describe("OTP-only authentication contract", () => {
  const retiredRoutes = [
    ["post", "/api/auth/phone-verification/start"],
    ["post", "/api/auth/phone-verification/status"],
    ["post", "/api/auth/sms-verification"],
    ["post", "/api/auth/devices/register"],
    ["get", "/api/auth/devices"],
    ["delete", "/api/auth/devices/device-id"],
    ["post", "/api/auth/device/challenge"],
    ["post", "/api/auth/device/authenticate"],
  ] as const;

  it.each(retiredRoutes)("does not expose %s %s", async (method, path) => {
    const routeRequest =
      method === "get"
        ? request(app).get(path)
        : method === "delete"
          ? request(app).delete(path)
          : request(app).post(path);
    const res = await routeRequest.send({});
    expect(res.status).toBe(404);
    expect(res.body.token).toBeUndefined();
  });

  it("keeps mobile OTP request available and removes retired paths from OpenAPI", async () => {
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: `6${RUN}` });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if this mobile/i);

    for (const path of [
      "/auth/phone-verification/start",
      "/auth/phone-verification/status",
      "/auth/sms-verification",
      "/auth/devices/register",
      "/auth/devices",
      "/auth/device/challenge",
      "/auth/device/authenticate",
    ]) {
      expect(openApiSpec).not.toContain(`  ${path}:`);
    }
    expect(openApiSpec).toContain("  /auth/otp/request:");
  });
});

// ── OTP request ───────────────────────────────────────────────────────────
describe("POST /api/auth/otp/request", () => {
  it("returns service unavailable instead of opening a dead verify flow when Hanu is not configured", async () => {
    mockHanuConfigured = false;
    try {
      const res = await request(app)
        .post("/api/auth/otp/request")
        .send({ mobile: MOBILE });
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/temporarily unavailable/i);
      expect(mockHanuSend).not.toHaveBeenCalled();
    } finally {
      mockHanuConfigured = true;
    }
  });

  it("returns generic 200 and sends a locally generated code through Hanu OTP", async () => {
    mockHanuSend.mockClear();
    mockHanuSend.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: MOBILE });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if this mobile/i);
    await vi.waitFor(() =>
      expect(
        mockHanuSend.mock.calls.some(
          ([mobile, code]) => mobile === MOBILE && /^\d{6}$/.test(code),
        ),
      ).toBe(true),
    );
  });

  it("returns the same generic 200 for an unknown mobile (no Hanu call)", async () => {
    mockHanuSend.mockClear();
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: "1234567890" }); // not in DB
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if this mobile/i);
    // Give the async fire-and-forget a tick to settle, then assert no call
    await new Promise((r) => setTimeout(r, 10));
    expect(mockHanuSend).not.toHaveBeenCalled();
  });

  it("returns generic 200 for an inactive user without calling Hanu", async () => {
    const INACTIVE_MOBILE = `8${RUN}`;
    mockHanuSend.mockClear();
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: INACTIVE_MOBILE });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if this mobile/i);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockHanuSend).not.toHaveBeenCalled();
  });

  it("accepts +91-prefixed mobile and normalises to 10 digits for DB lookup", async () => {
    mockHanuSend.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: `+91${MOBILE}` });
    expect(res.status).toBe(200);
  });

  it("accepts 91-prefixed 12-digit mobile", async () => {
    mockHanuSend.mockResolvedValueOnce({ ok: true });
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

  it("still returns 200 when Hanu send fails (provider failure never leaks)", async () => {
    mockHanuSend.mockResolvedValueOnce({ ok: false, reason: "Hanu down" });
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: PROVIDER_FAILURE_MOBILE });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if this mobile/i);
  });
});

// ── OTP resend ────────────────────────────────────────────────────────────
describe("POST /api/auth/otp/resend", () => {
  it("returns generic 200 and sends a fresh local code through Hanu OTP", async () => {
    mockHanuSend.mockClear();
    mockHanuSend.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/resend")
      .send({ mobile: MOBILE });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if this mobile/i);
    await vi.waitFor(() => expect(mockHanuSend).toHaveBeenCalled());
    expect(mockHanuSend).toHaveBeenCalledWith(MOBILE, expect.stringMatching(/^\d{6}$/));
  });

  it("returns the same generic 200 for an unknown mobile (no Hanu call)", async () => {
    mockHanuSend.mockClear();
    const unknownMobile = "0987654321";
    const res = await request(app)
      .post("/api/auth/otp/resend")
      .send({ mobile: unknownMobile }); // not in DB
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockHanuSend.mock.calls.some(([mobile]) => mobile === unknownMobile)).toBe(false);
  });

  it("still returns 200 when Hanu resend fails", async () => {
    mockHanuSend.mockResolvedValueOnce({ ok: false, reason: "provider unavailable" });
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

    mockHanuSend.mockResolvedValue({ ok: true });
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
  it("issues a session when the locally stored Hanu OTP is correct", async () => {
    const code = await createOtp(MOBILE, "login");
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: MOBILE, code });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(20);
    expect(res.body.user.mobile).toBe(MOBILE);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects when the locally stored Hanu OTP is wrong (no session issued)", async () => {
    const code = await createOtp(MOBILE, "login");
    const wrongCode = code === "000000" ? "000001" : "000000";
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: MOBILE, code: wrongCode });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/incorrect or expired/i);
    expect(res.body.token).toBeUndefined();
  });

  it("rejects for an inactive user even when the stored code is correct", async () => {
    const INACTIVE_MOBILE = `8${RUN}`;
    const code = await createOtp(INACTIVE_MOBILE, "login");
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: INACTIVE_MOBILE, code });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/account not found or inactive/i);
    expect(res.body.token).toBeUndefined();
  });

  it("rejects for an unknown mobile even when the stored code is correct", async () => {
    const code = await createOtp("5555555555", "login");
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: "5555555555", code });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/account not found or inactive/i);
    expect(res.body.token).toBeUndefined();
  });

  it("accepts +91-prefixed mobile in verify", async () => {
    const code = await createOtp(MOBILE, "login");
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: `+91${MOBILE}`, code });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
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

    const validCode = await createOtp(lockMobile, "login");
    const wrongCode = validCode === "000000" ? "000001" : "000000";
    let last: request.Response | undefined;
    for (let i = 0; i < 7; i++) {
      last = await request(app)
        .post("/api/auth/otp/verify")
        .send({ mobile: lockMobile, code: wrongCode });
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

    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: restartSafeMobile, code: "000000" });

    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/too many incorrect attempts/i);
    await db
      .delete(otpVerificationRateLimitsTable)
      .where(
        eq(
          otpVerificationRateLimitsTable.keyHash,
          otpVerificationRateLimitKeyHash(`otpverify:${restartSafeMobile}`),
        ),
      );
  });

  it("allows only one concurrent request to consume a correct OTP", async () => {
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

    const code = await createOtp(concurrentMobile, "login");
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app)
          .post("/api/auth/otp/verify")
          .send({ mobile: concurrentMobile, code }),
      ),
    );
    expect(responses.filter((res) => res.status === 200)).toHaveLength(1);
    expect(
      responses
        .filter((res) => res.status !== 200)
        .every((res) => res.status === 401 || res.status === 429),
    ).toBe(true);

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

  it("does not allow a consumed Hanu OTP to be reused", async () => {
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

    const code = await createOtp(delayedMobile, "login");
    const firstAttempt = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: delayedMobile, code });
    const retry = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: delayedMobile, code });
    expect(firstAttempt.status).toBe(200);
    expect(retry.status).toBe(401);
    expect(retry.body.token).toBeUndefined();

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

  it("does not issue a session when no local OTP record exists", async () => {
    await db.delete(otpCodesTable).where(eq(otpCodesTable.identifier, MOBILE));
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: MOBILE, code: "123456" });
    expect(res.status).toBe(401);
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

