// Integration tests for the auth routes, run against the real dev database.
// Email delivery and Hanu OTP delivery are mocked — no real network calls.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { and, eq, isNull, or } from "drizzle-orm";
import {
  db,
  loginEventsTable,
  otpCodesTable,
  otpVerificationRateLimitsTable,
  pool,
  sessionsTable,
  trustedDeviceTrustsTable,
  trustedDeviceRecoveryRateLimitsTable,
  usersTable,
  shopsTable,
  dealersTable,
  customersTable,
  customerUsersTable,
} from "@workspace/db";

vi.mock("../lib/mailer", () => ({
  sendOtpEmail: vi.fn(async () => {}),
  getMailFrom: () => "test@example.com",
  warnIfMailFromUnset: () => {},
}));

type HanuOtpResult =
  | { ok: true }
  | { ok: false; reason: string; invalidNumber?: boolean; notDispatched?: boolean };

// Mock Hanu OTP delivery — default to success so individual tests can override.
// Typed as vi.Mock to allow mockResolvedValueOnce calls without type errors.
const mockHanuSend = vi.fn(
  async (_mobile: string, _code: string): Promise<HanuOtpResult> => ({ ok: true }),
);
let mockHanuConfigured = true;
// Only delivery and configuration are faked. Number normalisation keeps the
// real implementation: a copy of it here once drifted from the provider's
// rules, and these tests kept passing while live sign-ins failed.
vi.mock("../lib/hanuOtp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/hanuOtp")>();
  return {
    ...actual,
    hanuSendOtp: (mobile: string, code: string) => mockHanuSend(mobile, code),
    getHanuOtpStatus: () => ({
      provider: "Hanu OTP",
      configured: mockHanuConfigured,
      endpoint: "https://api.hanuotp.in/sms-otp.php",
      templateId: "default",
      apiKeyConfigured: true,
    }),
  };
});

const { default: app } = await import("../app");
const {
  cleanupExpiredAuthData,
  createOtp,
  hashAndroidDeviceIdentifier,
  hashPassword,
} = await import("../lib/authUtils");
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
const ANDROID_ID = `a${RUN.padStart(15, "0")}`;

let userId: string;
let inactiveUserId: string;
let providerFailureUserId: string;
const PROVIDER_FAILURE_MOBILE = `7${RUN}`;
const UNKNOWN_MOBILE = `6${RUN}`;
// Extra distinct fixtures. Real Indian mobiles start with 6-9, so vary the
// second digit rather than the first to keep each number deliverable.
const altMobile = (tag: string) => `9${tag}${RUN.slice(0, 8)}`;

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
    mockHanuSend.mockClear();
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

  it("returns generic 200 and sends an OTP for an unknown mobile", async () => {
    mockHanuSend.mockClear();
    mockHanuSend.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: UNKNOWN_MOBILE }); // not in DB
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if this mobile/i);
    await vi.waitFor(() =>
      expect(mockHanuSend).toHaveBeenCalledWith(
        UNKNOWN_MOBILE,
        expect.stringMatching(/^\d{6}$/),
      ),
    );
  });

  it("returns generic 200 and sends an OTP for an inactive user", async () => {
    const INACTIVE_MOBILE = `8${RUN}`;
    mockHanuSend.mockClear();
    mockHanuSend.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: INACTIVE_MOBILE });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if this mobile/i);
    await vi.waitFor(() =>
      expect(mockHanuSend).toHaveBeenCalledWith(
        INACTIVE_MOBILE,
        expect.stringMatching(/^\d{6}$/),
      ),
    );
  });

  it("accepts +91-prefixed mobile and normalises it to 10 digits", async () => {
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
    expect(res.body.message).toMatch(/10-digit Indian mobile number starting with 6, 7, 8 or 9/i);
  });

  it("rejects a 10-digit number the SMS network cannot deliver to", async () => {
    mockHanuSend.mockClear();
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: `5${RUN}` });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/starting with 6, 7, 8 or 9/i);
    // The provider would refuse it anyway; don't spend a send to find out.
    expect(mockHanuSend).not.toHaveBeenCalled();
  });

  it("accepts a number typed with a leading zero and spacing", async () => {
    // Fresh number: the per-mobile throttle would otherwise mask the result.
    const typedMobile = altMobile("8");
    mockHanuSend.mockClear();
    mockHanuSend.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: `0${typedMobile.slice(0, 5)} ${typedMobile.slice(5)}` });
    expect(res.status).toBe(200);
    await vi.waitFor(() =>
      expect(mockHanuSend).toHaveBeenCalledWith(typedMobile, expect.stringMatching(/^\d{6}$/)),
    );
  });

  it("tells the caller to fix the number when the provider rejects it", async () => {
    mockHanuSend.mockResolvedValueOnce({
      ok: false,
      reason: "Hanu OTP error: Invalid mobile number.",
      invalidNumber: true,
    });
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: PROVIDER_FAILURE_MOBILE });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/starting with 6, 7, 8 or 9/i);
    const rows = await db
      .select({ id: otpCodesTable.id })
      .from(otpCodesTable)
      .where(eq(otpCodesTable.identifier, PROVIDER_FAILURE_MOBILE));
    expect(rows).toHaveLength(0);
  });

  it("returns a delivery error and invalidates the local code when Hanu send fails", async () => {
    mockHanuSend.mockResolvedValueOnce({ ok: false, reason: "Hanu down" });
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: PROVIDER_FAILURE_MOBILE });
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/could not send/i);
    expect(mockHanuSend).toHaveBeenCalledWith(
      PROVIDER_FAILURE_MOBILE,
      expect.stringMatching(/^\d{6}$/),
    );
    const rows = await db
      .select({ id: otpCodesTable.id })
      .from(otpCodesTable)
      .where(eq(otpCodesTable.identifier, PROVIDER_FAILURE_MOBILE));
    expect(rows).toHaveLength(0);
  });

  // Every OTP throttle is keyed per mobile AND per client IP. The app trusts
  // one proxy hop, so a forwarded address isolates each case's IP bucket from
  // the rest of this file.
  const fromIp = (ip: string) => request(app).post("/api/auth/otp/request").set("X-Forwarded-For", ip);
  // Numbers used only by the throttle cases below; the `8` + two-digit tag +
  // RUN tail shape cannot collide with MOBILE/altMobile/INACTIVE_MOBILE.
  const throttleMobile = (tag: number) => `8${String(tag).padStart(2, "0")}${RUN.slice(-7)}`;
  const notDispatched = { ok: false, reason: "Hanu OTP send failed: fetch failed", invalidNumber: false, notDispatched: true };

  it("does not spend the per-mobile throttle on sends that never reached the provider", async () => {
    // Per-mobile limit is 3 per window. During a DNS/connect outage every
    // attempt fails before dispatch, so a caller must still be able to retry
    // once the provider is back instead of being told they asked too often.
    const outageMobile = throttleMobile(90);
    const ip = "203.0.113.10";
    mockHanuSend.mockClear();
    for (let i = 0; i < 5; i++) {
      mockHanuSend.mockResolvedValueOnce(notDispatched);
      const res = await fromIp(ip).send({ mobile: outageMobile });
      expect(res.status).toBe(502);
      expect(res.body.message).toMatch(/could not send/i);
    }
    expect(mockHanuSend).toHaveBeenCalledTimes(5);

    // Provider recovers: delivered sends count as usual (3 allowed, 4th is 429).
    mockHanuSend.mockClear();
    mockHanuSend.mockResolvedValue({ ok: true });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await fromIp(ip).send({ mobile: outageMobile });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(mockHanuSend).toHaveBeenCalledTimes(3);
  });

  it("keeps charging the per-IP throttle for sends that never reached the provider", async () => {
    // Per-IP limit is 10 per window and is never refunded: it bounds the
    // unauthenticated work one client can cause during an outage.
    const ip = "203.0.113.13";
    mockHanuSend.mockClear();
    mockHanuSend.mockResolvedValue(notDispatched);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      // Rotate mobiles so only the IP dimension can deny.
      const probe = throttleMobile(10 + i);
      statuses.push((await fromIp(ip).send({ mobile: probe })).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 502)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect(mockHanuSend).toHaveBeenCalledTimes(10);
  });

  it("does not let a denied request fill the other dimension's bucket", async () => {
    mockHanuSend.mockClear();
    mockHanuSend.mockResolvedValue({ ok: true });

    // IP exhausted, mobile fresh: three denials must leave the victim's
    // per-mobile bucket untouched.
    const attackerIp = "203.0.113.14";
    for (let i = 0; i < 10; i++) {
      const filler = throttleMobile(30 + i);
      expect((await fromIp(attackerIp).send({ mobile: filler })).status).toBe(200);
    }
    const victimMobile = throttleMobile(91);
    for (let i = 0; i < 3; i++) {
      expect((await fromIp(attackerIp).send({ mobile: victimMobile })).status).toBe(429);
    }
    expect((await fromIp("203.0.113.15").send({ mobile: victimMobile })).status).toBe(200);

    // Mobile exhausted, IP fresh: denials must leave that IP's bucket untouched.
    const spentMobile = throttleMobile(92);
    const bystanderIp = "203.0.113.16";
    for (let i = 0; i < 3; i++) {
      expect((await fromIp(bystanderIp).send({ mobile: spentMobile })).status).toBe(200);
    }
    for (let i = 0; i < 10; i++) {
      expect((await fromIp(bystanderIp).send({ mobile: spentMobile })).status).toBe(429);
    }
    // 3 delivered + 0 charged denials leaves 7 IP slots: all of these succeed.
    for (let i = 0; i < 7; i++) {
      const other = throttleMobile(50 + i);
      expect((await fromIp(bystanderIp).send({ mobile: other })).status).toBe(200);
    }
  });

  it("still counts provider refusals, HTTP errors and timeouts against the throttle", async () => {
    // These may have reached the provider (or reveal something about the
    // number), so they must keep consuming slots: 3 attempts, then 429 without
    // another provider call.
    const cases = [
      { ok: false, reason: "Hanu OTP error: Invalid mobile number", invalidNumber: true, notDispatched: false },
      { ok: false, reason: "Hanu OTP returned HTTP 503: down", invalidNumber: false, notDispatched: false },
      { ok: false, reason: "Hanu OTP send failed: aborted", invalidNumber: false, notDispatched: false },
    ];
    const countedMobile = throttleMobile(93);
    const ip = "203.0.113.11";
    mockHanuSend.mockClear();
    const statuses: number[] = [];
    for (const outcome of cases) {
      mockHanuSend.mockResolvedValueOnce(outcome);
      statuses.push((await fromIp(ip).send({ mobile: countedMobile })).status);
    }
    expect(statuses).toEqual([400, 502, 502]);
    const fourth = await fromIp(ip).send({ mobile: countedMobile });
    expect(fourth.status).toBe(429);
    expect(mockHanuSend).toHaveBeenCalledTimes(3);
  });

  it("keeps the per-IP bound on provider calls when numbers vary", async () => {
    // Per-IP limit is 10 per window. Refusals must not refund the IP slot,
    // otherwise rotating through locally valid numbers gives an unbounded
    // number-validity oracle against the provider.
    const ip = "203.0.113.12";
    mockHanuSend.mockClear();
    mockHanuSend.mockResolvedValue({ ok: false, reason: "Hanu OTP error: Invalid mobile number", invalidNumber: true, notDispatched: false });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const probe = throttleMobile(70 + i);
      statuses.push((await fromIp(ip).send({ mobile: probe })).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect(mockHanuSend).toHaveBeenCalledTimes(10);
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

  it("returns generic 200 and sends a fresh OTP for an unknown mobile", async () => {
    mockHanuSend.mockClear();
    mockHanuSend.mockResolvedValueOnce({ ok: true });
    const unknownMobile = altMobile("7");
    const res = await request(app)
      .post("/api/auth/otp/resend")
      .send({ mobile: unknownMobile }); // not in DB
    expect(res.status).toBe(200);
    await vi.waitFor(() =>
      expect(mockHanuSend).toHaveBeenCalledWith(
        unknownMobile,
        expect.stringMatching(/^\d{6}$/),
      ),
    );
  });

  it("returns a delivery error and invalidates the local code when Hanu resend fails", async () => {
    mockHanuSend.mockResolvedValueOnce({ ok: false, reason: "provider unavailable" });
    const res = await request(app)
      .post("/api/auth/otp/resend")
      .send({ mobile: MOBILE });
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/could not resend/i);
    const rows = await db
      .select({ id: otpCodesTable.id })
      .from(otpCodesTable)
      .where(eq(otpCodesTable.identifier, MOBILE));
    expect(rows).toHaveLength(0);
  });

  it("rejects an invalid mobile format with 400", async () => {
    const res = await request(app)
      .post("/api/auth/otp/resend")
      .send({ mobile: "bad" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/10-digit Indian mobile number starting with 6, 7, 8 or 9/i);
  });

  it("returns 429 after exceeding resend rate limit", async () => {
    // Unique mobile to avoid polluting state from other tests.
    const throttleMobile = altMobile("5");
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

  it("does not spend the per-mobile resend throttle on sends that never reached the provider", async () => {
    // Resend limits are 2 per mobile and 5 per IP per window. Pre-dispatch
    // failures refund the mobile slot only; the first two delivered resends
    // then succeed and the third is denied by the mobile dimension.
    // Same collision-free shape as the request throttle cases (tags 94/95).
    const resendMobile = `894${RUN.slice(-7)}`;
    const ip = "203.0.113.20";
    const resend = (mobile: string) =>
      request(app).post("/api/auth/otp/resend").set("X-Forwarded-For", ip).send({ mobile });
    mockHanuSend.mockClear();
    for (let i = 0; i < 2; i++) {
      mockHanuSend.mockResolvedValueOnce({ ok: false, reason: "Hanu OTP send failed: fetch failed", invalidNumber: false, notDispatched: true });
      expect((await resend(resendMobile)).status).toBe(502);
    }
    mockHanuSend.mockResolvedValue({ ok: true });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await resend(resendMobile)).status);
    expect(statuses).toEqual([200, 200, 429]);
    // IP charged 2 (failed) + 2 (delivered); the denial released its slot, so
    // one IP slot remains for another number.
    expect((await resend(`895${RUN.slice(-7)}`)).status).toBe(200);
    expect(mockHanuSend).toHaveBeenCalledTimes(5);
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
    expect(res.body.user.name).toBe("Auth Test User");
    expect(res.body.needsDisplayName).toBe(false);
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

  it("creates an active standalone customer for an unknown mobile after OTP verification", async () => {
    const standaloneMobile = altMobile("6");
    const code = await createOtp(standaloneMobile, "login");
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: standaloneMobile, code });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("customer");
    expect(res.body.user.shopId).toBeUndefined();
    expect(res.body.needsDisplayName).toBe(true);
    expect(res.body.user.needsDisplayName).toBe(true);

    const interruptedCode = await createOtp(standaloneMobile, "login");
    const interruptedLogin = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: standaloneMobile, code: interruptedCode });
    expect(interruptedLogin.status).toBe(200);
    expect(interruptedLogin.body.needsDisplayName).toBe(true);
    expect(interruptedLogin.body.user.needsDisplayName).toBe(true);

    const unsafeName = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${res.body.token}`)
      .send({ name: "<script>alert(1)</script>" });
    expect(unsafeName.status).toBe(400);
    expect(unsafeName.body.message).toMatch(/unsupported characters/i);

    for (const bidiControl of ["\u061C", "\u200E", "\u200F"]) {
      const bidiName = await request(app)
        .patch("/api/auth/me")
        .set("Authorization", `Bearer ${res.body.token}`)
        .send({ name: `Priya${bidiControl}Customer` });
      expect(bidiName.status).toBe(400);
      expect(bidiName.body.message).toMatch(/unsupported characters/i);
    }

    const longName = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${res.body.token}`)
      .send({ name: "A".repeat(121) });
    expect(longName.status).toBe(400);
    expect(longName.body.message).toMatch(/120 characters or fewer/i);

    // The sign-in mobile is the key business records are linked by; a session
    // must not be able to move itself onto another number without an OTP.
    const mobileChange = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${res.body.token}`)
      .send({ mobile: altMobile("3") });
    expect(mobileChange.status).toBe(400);
    expect(mobileChange.body.code).toBe("MOBILE_CHANGE_REQUIRES_OTP");
    const sameMobile = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${res.body.token}`)
      .send({ mobile: res.body.user.mobile, name: "Priya Same" });
    expect(sameMobile.status).toBe(200);
    expect(sameMobile.body.user.mobile).toBe(res.body.user.mobile);

    const updatedName = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${res.body.token}`)
      .send({ name: "  Priya Customer  " });
    expect(updatedName.status).toBe(200);
    expect(updatedName.body.user.name).toBe("Priya Customer");
    expect(updatedName.body.user.needsDisplayName).toBe(false);

    const profile = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${res.body.token}`)
      .send({
        profileUsername: `  Priya_${RUN}  `,
        profileAbout: "  Repairs, tips, and updates.  ",
        profileLinks: ["https://example.test/profile"],
      });
    expect(profile.status).toBe(200);
    expect(profile.body.user.profileUsername).toBe(`priya_${RUN}`);
    expect(profile.body.user.profileAbout).toBe("Repairs, tips, and updates.");
    expect(profile.body.user.profileLinks).toEqual(["https://example.test/profile"]);

    const [usernameOwner] = await db.insert(usersTable).values({
      name: "Username Owner",
      email: `username-owner-${RUN}@example.test`,
      mobile: `6${RUN}`,
      passwordHash: hashPassword(PASSWORD),
      role: "customer",
      isActive: true,
      profileUsername: `taken_${RUN}`,
    }).returning();
    const duplicateUsername = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${res.body.token}`)
      .send({ profileUsername: `TAKEN_${RUN}` });
    expect(duplicateUsername.status).toBe(409);
    expect(duplicateUsername.body.message).toMatch(/already uses this username/i);
    const invalidUsername = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${res.body.token}`)
      .send({ profileUsername: "not valid!" });
    expect(invalidUsername.status).toBe(400);
    await db.delete(usersTable).where(eq(usersTable.id, usernameOwner.id));

    const completedCode = await createOtp(standaloneMobile, "login");
    const completedLogin = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: standaloneMobile, code: completedCode });
    expect(completedLogin.status).toBe(200);
    expect(completedLogin.body.needsDisplayName).toBe(false);
    expect(completedLogin.body.user.needsDisplayName).toBe(false);

    const [created] = await db.select().from(usersTable)
      .where(eq(usersTable.mobile, standaloneMobile));
    expect(created.isActive).toBe(true);
    expect(created.name).toBe("Priya Customer");
    expect(created.shopId).toBeNull();
    expect(created.dealerId).toBeNull();
    await db.delete(sessionsTable).where(eq(sessionsTable.userId, created.id));
    await db.delete(usersTable).where(eq(usersTable.id, created.id));
  });

  it("links a uniquely matching active dealer mobile as that dealer's owner", async () => {
    const mobile = altMobile("4");
    let ownerId: string | undefined;
    let shopId: string | undefined;
    let portalUserId: string | undefined;
    try {
      const [owner] = await db.insert(usersTable).values({
        name: "Dealer Link Shop Owner", email: `dealer-link-owner-${RUN}@example.test`,
        mobile: `6${RUN}`, role: "dealer", isActive: true,
      }).returning();
      ownerId = owner.id;
      const [shop] = await db.insert(shopsTable).values({
        dealerId: owner.id, businessName: "Dealer Link Shop",
      }).returning();
      shopId = shop.id;
      const [dealer] = await db.insert(dealersTable).values({
        shopId, dealerCode: `OTP-DLR-${RUN}`, name: "Unique Portal Dealer",
        mobile: `+91${mobile}`, isActive: true,
      }).returning();

      const code = await createOtp(mobile, "login");
      const res = await request(app).post("/api/auth/otp/verify").send({ mobile, code });
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe("dealer_owner");
      expect(res.body.user.shopId).toBe(shopId);
      expect(res.body.user.dealerId).toBe(dealer.id);

      const [linked] = await db.select().from(usersTable).where(eq(usersTable.mobile, mobile));
      portalUserId = linked.id;
      expect(linked.role).toBe("dealer_owner");
      expect(linked.shopId).toBe(shopId);
      expect(linked.dealerId).toBe(dealer.id);
    } finally {
      if (portalUserId) await db.delete(usersTable).where(eq(usersTable.id, portalUserId));
      await db.delete(otpCodesTable).where(eq(otpCodesTable.identifier, mobile));
      if (shopId) await db.delete(shopsTable).where(eq(shopsTable.id, shopId));
      if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    }
  });

  it("links a uniquely matching customer mobile and creates customer_users", async () => {
    const mobile = altMobile("3");
    let ownerId: string | undefined;
    let shopId: string | undefined;
    let portalUserId: string | undefined;
    try {
      const [owner] = await db.insert(usersTable).values({
        name: "Customer Link Shop Owner", email: `customer-link-owner-${RUN}@example.test`,
        mobile: altMobile("0"), role: "dealer", isActive: true,
      }).returning();
      ownerId = owner.id;
      const [shop] = await db.insert(shopsTable).values({
        dealerId: owner.id, businessName: "Customer Link Shop",
      }).returning();
      shopId = shop.id;
      const [customer] = await db.insert(customersTable).values({
        shopId, name: "Unique Portal Customer", mobile: `+91${mobile}`,
      }).returning();

      const code = await createOtp(mobile, "login");
      const res = await request(app).post("/api/auth/otp/verify").send({ mobile, code });
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe("customer");
      expect(res.body.user.shopId).toBe(shopId);

      const [linked] = await db.select().from(usersTable).where(eq(usersTable.mobile, mobile));
      portalUserId = linked.id;
      const [link] = await db.select().from(customerUsersTable)
        .where(and(eq(customerUsersTable.userId, linked.id), eq(customerUsersTable.customerId, customer.id)));
      expect(linked.shopId).toBe(shopId);
      expect(linked.dealerId).toBeNull();
      expect(link.shopId).toBe(shopId);
    } finally {
      if (portalUserId) await db.delete(usersTable).where(eq(usersTable.id, portalUserId));
      await db.delete(otpCodesTable).where(eq(otpCodesTable.identifier, mobile));
      if (shopId) await db.delete(shopsTable).where(eq(shopsTable.id, shopId));
      if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    }
  });

  it("opens the dealer portal when the mobile is both a dealer party and a walk-in customer", async () => {
    const mobile = altMobile("2");
    let ownerId: string | undefined;
    let shopId: string | undefined;
    let portalUserId: string | undefined;
    try {
      const [owner] = await db.insert(usersTable).values({
        name: "Dual Link Shop Owner", email: `dual-link-owner-${RUN}@example.test`,
        mobile: altMobile("1"), role: "dealer", isActive: true,
      }).returning();
      ownerId = owner.id;
      const [shop] = await db.insert(shopsTable).values({
        dealerId: owner.id, businessName: "Dual Link Shop",
      }).returning();
      shopId = shop.id;
      const [dealer] = await db.insert(dealersTable).values({
        shopId, dealerCode: `OTP-DUAL-${RUN}`, name: "Dual Dealer", mobile, isActive: true,
      }).returning();
      // Two walk-in rows for the same number: staff entered the person twice.
      const [customerA] = await db.insert(customersTable).values({
        shopId, name: "Dual Customer", mobile: `+91${mobile}`,
      }).returning();
      const [customerB] = await db.insert(customersTable).values({
        shopId, name: "Dual Customer (again)", mobile,
      }).returning();

      const code = await createOtp(mobile, "login");
      const res = await request(app).post("/api/auth/otp/verify").send({ mobile, code });
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe("dealer_owner");
      expect(res.body.user.shopId).toBe(shopId);
      expect(res.body.user.dealerId).toBe(dealer.id);

      const [linked] = await db.select().from(usersTable).where(eq(usersTable.mobile, mobile));
      portalUserId = linked.id;
      const links = await db.select().from(customerUsersTable)
        .where(eq(customerUsersTable.userId, linked.id));
      expect(links.map((link) => link.customerId).sort()).toEqual([customerA.id, customerB.id].sort());
      expect(links.every((link) => link.shopId === shopId)).toBe(true);

      // The dealer portal profile names the shop as this login's supplier.
      const me = await request(app).get("/api/dealers/me").set("Authorization", `Bearer ${res.body.token}`);
      expect(me.status).toBe(200);
      expect(me.body.supplier).toEqual({
        businessName: "Dual Link Shop",
        ownerName: "Dual Link Shop Owner",
        ownerMobile: altMobile("1"),
      });
    } finally {
      if (portalUserId) await db.delete(usersTable).where(eq(usersTable.id, portalUserId));
      await db.delete(otpCodesTable).where(eq(otpCodesTable.identifier, mobile));
      if (shopId) await db.delete(shopsTable).where(eq(shopsTable.id, shopId));
      if (ownerId) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    }
  });

  it("links every duplicate customer row of the newest shop and skips rows owned by another login", async () => {
    const mobile = altMobile("6");
    const ownerIds: string[] = [];
    const shopIds: string[] = [];
    let portalUserId: string | undefined;
    let otherUserId: string | undefined;
    try {
      const makeShop = async (tag: string) => {
        const [owner] = await db.insert(usersTable).values({
          name: `Dup Owner ${tag}`, email: `dup-owner-${tag}-${RUN}@example.test`,
          mobile: `7${tag}${RUN.slice(0, 8)}`, role: "dealer", isActive: true,
        }).returning();
        ownerIds.push(owner.id);
        const [shop] = await db.insert(shopsTable).values({
          dealerId: owner.id, businessName: `Dup Shop ${tag}`,
        }).returning();
        shopIds.push(shop.id);
        return shop.id;
      };
      const olderShopId = await makeShop("1");
      const newerShopId = await makeShop("2");
      const past = new Date(Date.now() - 60_000);
      await db.insert(customersTable).values({
        shopId: olderShopId, name: "Older Shop Row", mobile, createdAt: past,
      });
      const [newerA] = await db.insert(customersTable).values({
        shopId: newerShopId, name: "Newer Shop Row", mobile,
      }).returning();
      const [newerB] = await db.insert(customersTable).values({
        shopId: newerShopId, name: "Newer Shop Row 2", mobile: `91${mobile}`,
      }).returning();
      const [claimed] = await db.insert(customersTable).values({
        shopId: newerShopId, name: "Claimed Row", mobile,
      }).returning();
      // A different login already owns one of the rows; it must stay theirs.
      const [other] = await db.insert(usersTable).values({
        name: "Other Login", email: `dup-other-${RUN}@example.test`,
        mobile: `79${RUN.slice(0, 8)}`, role: "customer", isActive: true, shopId: newerShopId,
      }).returning();
      otherUserId = other.id;
      await db.insert(customerUsersTable).values({ userId: other.id, customerId: claimed.id, shopId: newerShopId });

      const code = await createOtp(mobile, "login");
      const res = await request(app).post("/api/auth/otp/verify").send({ mobile, code });
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe("customer");
      expect(res.body.user.shopId).toBe(newerShopId);

      const [linked] = await db.select().from(usersTable).where(eq(usersTable.mobile, mobile));
      portalUserId = linked.id;
      const links = await db.select().from(customerUsersTable)
        .where(eq(customerUsersTable.userId, linked.id));
      expect(links.map((link) => link.customerId).sort()).toEqual([newerA.id, newerB.id].sort());
      const [claimedLink] = await db.select().from(customerUsersTable)
        .where(eq(customerUsersTable.customerId, claimed.id));
      expect(claimedLink.userId).toBe(other.id);

      // The portal lists repairs across every owned row and the ledger merges them.
      const khata = await request(app).get("/api/customers/me/khata").set("Authorization", `Bearer ${res.body.token}`);
      expect(khata.status).toBe(200);
      expect([newerA.id, newerB.id]).toContain(khata.body.customer.id);
    } finally {
      if (portalUserId) await db.delete(usersTable).where(eq(usersTable.id, portalUserId));
      if (otherUserId) await db.delete(usersTable).where(eq(usersTable.id, otherUserId));
      await db.delete(otpCodesTable).where(eq(otpCodesTable.identifier, mobile));
      for (const shopId of shopIds) await db.delete(shopsTable).where(eq(shopsTable.id, shopId));
      for (const ownerId of ownerIds) await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    }
  });

  it("uses the mobile unique index as a concurrency-safe standalone provisioning mutex", async () => {
    const raceMobile = altMobile("1");
    const inserts = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        db.insert(usersTable).values({
          name: "Customer",
          email: `otp-race-${RUN}-${index}@standalone.local`,
          mobile: raceMobile,
          passwordHash: null,
          role: "customer",
          isActive: true,
        }).onConflictDoNothing({ target: usersTable.mobile }).returning(),
      ),
    );
    expect(inserts.flat()).toHaveLength(1);
    const rows = await db.select().from(usersTable).where(eq(usersTable.mobile, raceMobile));
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("customer");
    expect(rows[0].shopId).toBeNull();
    await db.delete(usersTable).where(eq(usersTable.id, rows[0].id));
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
    const restartSafeMobile = altMobile("4");
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
    const concurrentMobile = altMobile("3");
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
    const delayedMobile = altMobile("2");
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
    expect(res.body.message).toMatch(/10-digit Indian mobile number starting with 6, 7, 8 or 9/i);
  });
});

// ── Android trusted-device recovery ────────────────────────────────────────
describe("trusted Android device recovery", () => {
  beforeEach(async () => {
    // The limiter is deliberately durable across process restarts. Keep this
    // integration group isolated despite reusing Supertest's IP and device IDs.
    await db.delete(trustedDeviceRecoveryRateLimitsTable);
  });

  it("hashes OTP-enrolled identifiers and recovers without sliding the deadline", async () => {
    const code = await createOtp(MOBILE, "login");
    const enrolled = await request(app).post("/api/auth/otp/verify").send({
      mobile: MOBILE,
      code,
      androidDeviceId: ANDROID_ID,
      deviceInfo: "Android test device",
    });
    expect(enrolled.status).toBe(200);

    const [trust] = await db
      .select()
      .from(trustedDeviceTrustsTable)
      .where(eq(trustedDeviceTrustsTable.userId, userId));
    expect(trust.androidIdHash).toBe(hashAndroidDeviceIdentifier(ANDROID_ID));
    expect(trust.androidIdHash).not.toBe(ANDROID_ID);
    expect(trust.expiresAt.getTime() - trust.createdAt.getTime()).toBeLessThanOrEqual(48 * 60 * 60 * 1000);
    expect(trust.recoveryDeadline.getTime() - trust.createdAt.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    const [otpSession] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.token, enrolled.body.token));
    expect(otpSession.expiresAt.getUTCFullYear()).toBe(9999);
    expect(otpSession.expiresAt.getTime()).toBeGreaterThan(trust.expiresAt.getTime());

    const recovered = await request(app)
      .post("/api/auth/trusted-device/recover")
      .send({ androidDeviceId: ANDROID_ID });
    expect(recovered.status).toBe(200);
    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.token, recovered.body.token));
    expect(session.expiresAt.getTime()).toBe(trust.recoveryDeadline.getTime());

    const [afterRecovery] = await db
      .select()
      .from(trustedDeviceTrustsTable)
      .where(eq(trustedDeviceTrustsTable.id, trust.id));
    expect(afterRecovery.recoveryDeadline.getTime()).toBe(trust.recoveryDeadline.getTime());
  });

  it("fails generically after expiry or explicit current-device logout", async () => {
    const code = await createOtp(MOBILE, "login");
    const enrolled = await request(app).post("/api/auth/otp/verify").send({
      mobile: MOBILE,
      code,
      androidDeviceId: ANDROID_ID,
    });
    expect(enrolled.status).toBe(200);
    const [enrolledSession] = await db
      .select({ trustedDeviceId: sessionsTable.trustedDeviceId })
      .from(sessionsTable)
      .where(eq(sessionsTable.token, enrolled.body.token));
    expect(enrolledSession.trustedDeviceId).toBeTruthy();
    const loggedOut = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${enrolled.body.token}`);
    expect(loggedOut.status).toBe(200);
    const revokedRecovery = await request(app)
      .post("/api/auth/trusted-device/recover")
      .send({ androidDeviceId: ANDROID_ID });
    expect(revokedRecovery.status).toBe(401);
    expect(revokedRecovery.body.message).toMatch(/recover this device/i);

    await db
      .update(trustedDeviceTrustsTable)
      .set({ revokedAt: null, expiresAt: new Date(Date.now() - 1), recoveryDeadline: new Date(Date.now() - 1) })
      .where(eq(trustedDeviceTrustsTable.id, enrolledSession.trustedDeviceId!));
    const expiredRecovery = await request(app)
      .post("/api/auth/trusted-device/recover")
      .send({ androidDeviceId: ANDROID_ID });
    expect(expiredRecovery.status).toBe(401);
  });

  it("rejects malformed identifiers and fails closed for inactive or ambiguous matches", async () => {
    const malformed = await request(app)
      .post("/api/auth/trusted-device/recover")
      .send({ androidDeviceId: "356938035643809" }); // IMEI-shaped, not ANDROID_ID
    expect(malformed.status).toBe(400);

    const hash = hashAndroidDeviceIdentifier(ANDROID_ID);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await db.insert(trustedDeviceTrustsTable).values({
      userId: inactiveUserId,
      androidIdHash: hash,
      expiresAt: future,
      recoveryDeadline: future,
    });
    const inactive = await request(app)
      .post("/api/auth/trusted-device/recover")
      .send({ androidDeviceId: ANDROID_ID });
    expect(inactive.status).toBe(401);

    const [other] = await db.insert(usersTable).values({
      name: "Ambiguous device user",
      email: `ambiguous-${RUN}@example.test`,
      mobile: altMobile("1"),
      passwordHash: hashPassword(PASSWORD),
      role: "dealer",
      isActive: true,
    }).returning();
    const [currentTrust] = await db
      .select({ id: trustedDeviceTrustsTable.id })
      .from(trustedDeviceTrustsTable)
      .where(and(
        eq(trustedDeviceTrustsTable.userId, userId),
        eq(trustedDeviceTrustsTable.androidIdHash, hash),
        isNull(trustedDeviceTrustsTable.revokedAt),
      ))
      .limit(1);
    await db
      .update(trustedDeviceTrustsTable)
      .set({ revokedAt: null, expiresAt: future, recoveryDeadline: future })
      .where(eq(trustedDeviceTrustsTable.id, currentTrust.id));
    await db.insert(trustedDeviceTrustsTable).values({
      userId: other.id,
      androidIdHash: hash,
      expiresAt: future,
      recoveryDeadline: future,
    });
    const ambiguous = await request(app)
      .post("/api/auth/trusted-device/recover")
      .send({ androidDeviceId: ANDROID_ID });
    expect(ambiguous.status).toBe(401);
    await db.delete(usersTable).where(eq(usersTable.id, other.id));
  });

  it("cleans up expired trusted-device records", async () => {
    const [expired] = await db.insert(trustedDeviceTrustsTable).values({
      userId,
      androidIdHash: hashAndroidDeviceIdentifier("b000000000000000"),
      expiresAt: new Date(Date.now() - 1),
      recoveryDeadline: new Date(Date.now() - 1),
    }).returning();
    await db.insert(trustedDeviceRecoveryRateLimitsTable).values({
      keyHash: hashAndroidDeviceIdentifier(`rate-limit-${RUN}`),
      attemptCount: 1,
      windowStartedAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() - 1),
    });
    const result = await cleanupExpiredAuthData();
    expect(result.trustedDeviceTrusts).toBeGreaterThanOrEqual(1);
    expect(result.trustedDeviceRecoveryRateLimits).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(trustedDeviceTrustsTable)
      .where(eq(trustedDeviceTrustsTable.id, expired.id));
    expect(rows).toHaveLength(0);
  });

  it("rotates immutable generations, invalidates stale sessions, and replaces recovery sessions", async () => {
    const rotatingId = `c${RUN.padStart(15, "0")}`;
    const firstCode = await createOtp(MOBILE, "login");
    const first = await request(app).post("/api/auth/otp/verify").send({
      mobile: MOBILE, code: firstCode, androidDeviceId: rotatingId,
    });
    const firstSession = await db.select().from(sessionsTable)
      .where(eq(sessionsTable.token, first.body.token));
    const secondCode = await createOtp(MOBILE, "login");
    const second = await request(app).post("/api/auth/otp/verify").send({
      mobile: MOBILE, code: secondCode, androidDeviceId: rotatingId,
    });
    expect(second.status).toBe(200);
    const oldSession = await db.select().from(sessionsTable)
      .where(eq(sessionsTable.token, first.body.token));
    expect(oldSession).toHaveLength(0);
    const generations = await db.select().from(trustedDeviceTrustsTable)
      .where(eq(trustedDeviceTrustsTable.androidIdHash, hashAndroidDeviceIdentifier(rotatingId)));
    expect(generations.filter((trust) => trust.revokedAt === null)).toHaveLength(1);
    expect(generations.some((trust) => trust.id === firstSession[0].trustedDeviceId && trust.revokedAt)).toBe(true);

    // The stale session is unusable and therefore cannot revoke the fresh generation.
    expect((await request(app).post("/api/auth/logout")
      .set("Authorization", `Bearer ${first.body.token}`)).status).toBe(401);
    const recovery1 = await request(app).post("/api/auth/trusted-device/recover")
      .send({ androidDeviceId: rotatingId });
    const recovery2 = await request(app).post("/api/auth/trusted-device/recover")
      .send({ androidDeviceId: rotatingId });
    expect(recovery1.status).toBe(200);
    expect(recovery2.status).toBe(200);
    expect((await request(app).get("/api/auth/me")
      .set("Authorization", `Bearer ${recovery1.body.token}`)).status).toBe(401);
    expect((await request(app).get("/api/auth/me")
      .set("Authorization", `Bearer ${recovery2.body.token}`)).status).toBe(200);
  });

  it("revokes trusted recovery for targeted sessions and revoke-others", async () => {
    const targetId = `d${RUN.padStart(15, "0")}`;
    const targetCode = await createOtp(MOBILE, "login");
    const target = await request(app).post("/api/auth/otp/verify").send({
      mobile: MOBILE, code: targetCode, androidDeviceId: targetId,
    });
    const [targetSession] = await db.select().from(sessionsTable)
      .where(eq(sessionsTable.token, target.body.token));
    expect((await request(app).delete(`/api/auth/sessions/${targetSession.id}`)
      .set("Authorization", `Bearer ${target.body.token}`)).status).toBe(200);
    expect((await request(app).post("/api/auth/trusted-device/recover")
      .send({ androidDeviceId: targetId })).status).toBe(401);

    const keeperCode = await createOtp(MOBILE, "login");
    const keeper = await request(app).post("/api/auth/otp/verify").send({ mobile: MOBILE, code: keeperCode });
    const otherId = `e${RUN.padStart(15, "0")}`;
    const otherCode = await createOtp(MOBILE, "login");
    await request(app).post("/api/auth/otp/verify").send({
      mobile: MOBILE, code: otherCode, androidDeviceId: otherId,
    });
    expect((await request(app).post("/api/auth/sessions/revoke-others")
      .set("Authorization", `Bearer ${keeper.body.token}`)).status).toBe(200);
    expect((await request(app).post("/api/auth/trusted-device/recover")
      .send({ androidDeviceId: otherId })).status).toBe(401);
  });

  it("serializes concurrent recovery and every explicit revocation path without server errors", async () => {
    async function enroll(id: string) {
      const code = await createOtp(MOBILE, "login");
      const response = await request(app).post("/api/auth/otp/verify").send({
        mobile: MOBILE, code, androidDeviceId: id,
      });
      const [session] = await db.select().from(sessionsTable)
        .where(eq(sessionsTable.token, response.body.token));
      return { token: response.body.token as string, sessionId: session.id };
    }
    async function assertRace(id: string, revoke: Promise<request.Response>) {
      const [recovery, revoked] = await Promise.all([
        request(app).post("/api/auth/trusted-device/recover").send({ androidDeviceId: id }),
        revoke,
      ]);
      expect([recovery.status, revoked.status]).not.toContain(500);
      if (revoked.status === 200) {
        expect((await request(app).post("/api/auth/trusted-device/recover")
          .send({ androidDeviceId: id })).status).toBe(401);
      }
    }

    const logoutId = `f${RUN.padStart(15, "0")}`;
    const logout = await enroll(logoutId);
    await assertRace(logoutId, request(app).post("/api/auth/logout")
      .set("Authorization", `Bearer ${logout.token}`));

    const targetedId = `a${RUN.padStart(14, "0")}b`;
    const targeted = await enroll(targetedId);
    await assertRace(targetedId, request(app).delete(`/api/auth/sessions/${targeted.sessionId}`)
      .set("Authorization", `Bearer ${targeted.token}`));

    const keeperCode = await createOtp(MOBILE, "login");
    const keeper = await request(app).post("/api/auth/otp/verify").send({ mobile: MOBILE, code: keeperCode });
    const othersId = `b${RUN.padStart(14, "0")}c`;
    await enroll(othersId);
    await assertRace(othersId, request(app).post("/api/auth/sessions/revoke-others")
      .set("Authorization", `Bearer ${keeper.body.token}`));
  });

  it("fails closed after concurrent second-user enrollment creates an ambiguous Android hash", async () => {
    const sharedId = `9${RUN.padStart(15, "0")}`;
    const firstCode = await createOtp(MOBILE, "login");
    const firstEnrollment = await request(app).post("/api/auth/otp/verify").send({
      mobile: MOBILE,
      code: firstCode,
      androidDeviceId: sharedId,
    });
    expect(firstEnrollment.status).toBe(200);

    const [secondUser] = await db.insert(usersTable).values({
      name: "Concurrent ambiguous device user",
      email: `concurrent-ambiguous-${RUN}@example.test`,
      mobile: altMobile("0"),
      passwordHash: hashPassword(PASSWORD),
      role: "dealer",
      isActive: true,
    }).returning();

    try {
      const secondCode = await createOtp(secondUser.mobile, "login");
      // The global device-hash advisory lock makes either ordering safe. The
      // raced recovery may legitimately win before user B enrolls, or fail
      // after B enrolls; neither ordering may produce a server error.
      const [secondEnrollment, racedRecovery] = await Promise.all([
        request(app).post("/api/auth/otp/verify").send({
          mobile: secondUser.mobile,
          code: secondCode,
          androidDeviceId: sharedId,
        }),
        request(app).post("/api/auth/trusted-device/recover").send({
          androidDeviceId: sharedId,
        }),
      ]);
      expect(secondEnrollment.status).toBe(200);
      expect(secondEnrollment.status).not.toBe(500);
      expect(racedRecovery.status).not.toBe(500);
      expect([200, 401]).toContain(racedRecovery.status);

      const activeGenerations = await db
        .select()
        .from(trustedDeviceTrustsTable)
        .where(and(
          eq(trustedDeviceTrustsTable.androidIdHash, hashAndroidDeviceIdentifier(sharedId)),
          isNull(trustedDeviceTrustsTable.revokedAt),
        ));
      expect(activeGenerations).toHaveLength(2);

      // Once both commits are visible, exact-one matching must fail closed.
      const ambiguousRecovery = await request(app)
        .post("/api/auth/trusted-device/recover")
        .send({ androidDeviceId: sharedId });
      expect(ambiguousRecovery.status).toBe(401);
      expect(ambiguousRecovery.body.token).toBeUndefined();
    } finally {
      await db.delete(sessionsTable).where(eq(sessionsTable.userId, secondUser.id));
      await db.delete(loginEventsTable).where(eq(loginEventsTable.userId, secondUser.id));
      await db.delete(otpCodesTable).where(eq(otpCodesTable.identifier, secondUser.mobile));
      await db.delete(usersTable).where(eq(usersTable.id, secondUser.id));
    }
  });
});

