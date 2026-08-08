// Integration tests for the auth routes, run against the real dev database.
// Email delivery is mocked — no real emails are sent.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, like, or } from "drizzle-orm";
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

const { default: app } = await import("../app");
const { createOtp, hashPassword, sha256 } = await import("../lib/authUtils");

// Unique-per-run identifiers so parallel/repeated runs never collide.
const RUN = Date.now().toString().slice(-9);
const EMAIL = `authtest-${RUN}@example.test`;
const MOBILE = `9${RUN}`; // 10 digits
const PASSWORD = "Test1234!";

let userId: string;

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
});

afterAll(async () => {
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
  await db.delete(loginEventsTable).where(eq(loginEventsTable.userId, userId));
  await db
    .delete(otpCodesTable)
    .where(or(eq(otpCodesTable.identifier, EMAIL), eq(otpCodesTable.identifier, MOBILE)));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await pool.end();
});

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

describe("POST /api/auth/otp/verify", () => {
  it("accepts a valid code once, then rejects the same code (consumed)", async () => {
    const code = await createOtp(MOBILE, "login");

    const first = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: MOBILE, code });
    expect(first.status).toBe(200);
    expect(typeof first.body.token).toBe("string");

    const second = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: MOBILE, code });
    expect(second.status).toBe(401);
    expect(second.body.message).toMatch(/expired or not found/i);
  });

  it("rejects an incorrect code with a retryable message", async () => {
    await createOtp(MOBILE, "login");
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: MOBILE, code: "000000" });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/incorrect code/i);
  });

  it("rejects an expired code", async () => {
    // Insert an already-expired OTP row directly
    await db.delete(otpCodesTable).where(eq(otpCodesTable.identifier, MOBILE));
    await db.insert(otpCodesTable).values({
      identifier: MOBILE,
      purpose: "login",
      codeHash: sha256("123456"),
      expiresAt: new Date(Date.now() - 60_000),
    });
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ mobile: MOBILE, code: "123456" });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/expired or not found/i);
  });
});

describe("forgot password flow", () => {
  it("verifies a reset code, resets the password, and rejects reset-token reuse", async () => {
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
