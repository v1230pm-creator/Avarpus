// Integration tests for the registration flow (/auth/register/start + /verify),
// run against the real dev database. Email delivery is mocked — no real emails.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, like, or } from "drizzle-orm";
import {
  db,
  loginEventsTable,
  otpCodesTable,
  pool,
  sessionsTable,
  shopsTable,
  usersTable,
} from "@workspace/db";

const sendOtpEmailMock = vi.fn<(to: string, code: string, purpose: string, tags?: Record<string, string>) => Promise<string | null>>(
  async () => "test-resend-email-id",
);
vi.mock("../lib/mailer", () => ({
  sendOtpEmail: (to: string, code: string, purpose: string, tags?: Record<string, string>) =>
    sendOtpEmailMock(to, code, purpose, tags),
  getMailFrom: () => "test@example.com",
  warnIfMailFromUnset: () => {},
}));

const { default: app } = await import("../app");
const { createOtp, hashPassword } = await import("../lib/authUtils");

// Unique-per-run identifiers so parallel/repeated runs never collide.
const RUN = Date.now().toString().slice(-8);
const PASSWORD = "Test1234";
// 10-digit mobiles: 2-digit prefix + 8-digit run suffix
const mob = (prefix: string) => `${prefix}${RUN}`;
const mail = (tag: string) => `regtest-${tag}-${RUN}@example.test`;

// Existing dealer whose shop staff will join.
let dealerId: string;
let dealerShopId: string;
const DEALER_EMAIL = mail("dealer0");
const DEALER_MOBILE = mob("70");

beforeAll(async () => {
  const [dealer] = await db
    .insert(usersTable)
    .values({
      name: "Reg Test Dealer",
      email: DEALER_EMAIL,
      mobile: DEALER_MOBILE,
      passwordHash: hashPassword(PASSWORD),
      role: "dealer",
      isActive: true,
    })
    .returning();
  dealerId = dealer.id;
  const [shop] = await db
    .insert(shopsTable)
    .values({ dealerId, businessName: "Reg Test Shop", address: "Test Lane" })
    .returning();
  dealerShopId = shop.id;
  await db.update(usersTable).set({ shopId: dealerShopId }).where(eq(usersTable.id, dealerId));
});

afterAll(async () => {
  // Remove everything created during this run (emails share the regtest-*-RUN pattern).
  const created = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(like(usersTable.email, `regtest-%-${RUN}@example.test`));
  const ids = created.map((u) => u.id);
  for (const id of ids) {
    await db.delete(sessionsTable).where(eq(sessionsTable.userId, id));
    await db.delete(loginEventsTable).where(eq(loginEventsTable.userId, id));
  }
  await db.delete(shopsTable).where(or(...ids.map((id) => eq(shopsTable.dealerId, id))));
  await db.delete(otpCodesTable).where(like(otpCodesTable.identifier, `regtest-%-${RUN}@example.test`));
  for (const id of ids) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
  await pool.end();
});

const dealerPayload = (tag: string, mobilePrefix: string) => ({
  name: "New Dealer",
  businessName: "New Dealer Business",
  email: mail(tag),
  mobile: mob(mobilePrefix),
  password: PASSWORD,
  shopAddress: "12 Market Road",
});

describe("POST /api/auth/register/start", () => {
  it("accepts a valid dealer registration and sends the OTP email", async () => {
    const res = await request(app)
      .post("/api/auth/register/start")
      .send(dealerPayload("start-ok", "71"));
    expect(res.status).toBe(200);
    expect(res.body.message).toContain(mail("start-ok"));
    expect(sendOtpEmailMock).toHaveBeenCalledWith(
      mail("start-ok"),
      expect.any(String),
      "registration",
      { avarpus_email_kind: "registration_verification" },
    );
  });

  it("accepts a valid staff registration against a known dealer mobile", async () => {
    const res = await request(app).post("/api/auth/register/start").send({
      name: "New Staff",
      email: mail("staff-start"),
      mobile: mob("72"),
      password: PASSWORD,
      role: "technician",
      dealerMobile: DEALER_MOBILE,
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain(mail("staff-start"));
    expect(sendOtpEmailMock).toHaveBeenLastCalledWith(
      mail("staff-start"),
      expect.any(String),
      "registration",
      {
        avarpus_email_kind: "registration_verification",
        avarpus_shop_id: dealerShopId,
      },
    );
  });

  it("rejects a staff registration with an unknown dealer mobile (404)", async () => {
    const res = await request(app).post("/api/auth/register/start").send({
      name: "Lost Staff",
      email: mail("staff-lost"),
      mobile: mob("73"),
      password: PASSWORD,
      role: "reception",
      dealerMobile: "0000000000",
    });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/no shop found/i);
  });

  it("rejects duplicate email with 409", async () => {
    const res = await request(app)
      .post("/api/auth/register/start")
      .send({ ...dealerPayload("dupe-email", "74"), email: DEALER_EMAIL });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it("rejects duplicate mobile with 409", async () => {
    const res = await request(app)
      .post("/api/auth/register/start")
      .send({ ...dealerPayload("dupe-mobile", "75"), mobile: DEALER_MOBILE });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it("rejects forbidden roles (admin / super_admin) with 403", async () => {
    for (const role of ["admin", "super_admin"]) {
      const res = await request(app)
        .post("/api/auth/register/start")
        .send({ ...dealerPayload("forbidden", "76"), role });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/limited to dealer or staff roles/i);
    }
  });

  it("rejects a weak password with a descriptive 400", async () => {
    const res = await request(app)
      .post("/api/auth/register/start")
      .send({ ...dealerPayload("weak-pass", "77"), password: "weakpass" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8\+ characters/);
  });

  it("rejects missing dealer fields with 400", async () => {
    const res = await request(app).post("/api/auth/register/start").send({
      name: "No Biz",
      email: mail("no-biz"),
      mobile: mob("78"),
      password: PASSWORD,
      // businessName and shopAddress missing for a dealer registration
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/missing or invalid/i);
  });

  it("enforces the 60s resend cooldown per email (429)", async () => {
    const payload = dealerPayload("cooldown", "79");
    const first = await request(app).post("/api/auth/register/start").send(payload);
    expect(first.status).toBe(200);
    const second = await request(app).post("/api/auth/register/start").send(payload);
    expect(second.status).toBe(429);
    expect(second.body.message).toMatch(/please wait .* before requesting another code/i);
  });

  it("returns 502 (not a silent success) when the OTP email fails to send", async () => {
    sendOtpEmailMock.mockRejectedValueOnce(new Error("resend down"));
    const res = await request(app)
      .post("/api/auth/register/start")
      .send(dealerPayload("mail-fail", "80"));
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/could not send the verification email/i);
  });
});

describe("POST /api/auth/register/verify", () => {
  const dealerOtpPayload = (email: string, mobile: string) => ({
    kind: "dealer" as const,
    name: "Verified Dealer",
    businessName: "Verified Dealer Biz",
    email,
    mobile,
    passwordHash: hashPassword(PASSWORD),
    gstNumber: null,
    shopAddress: "34 Verify Street",
    role: "dealer",
    shopId: null,
  });

  it("creates dealer user + shop in one transaction and signs the dealer in", async () => {
    const email = mail("verify-dealer");
    const mobile = mob("81");
    const code = await createOtp(email, "register", dealerOtpPayload(email, mobile));
    const res = await request(app)
      .post("/api/auth/register/verify")
      .send({ email, code });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.role).toBe("dealer");
    expect(res.body.user.isActive).toBe(true);
    expect(res.body.user.passwordHash).toBeUndefined();
    // User and shop were created and linked
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    expect(user.shopId).toBeTruthy();
    const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, user.shopId!));
    expect(shop.dealerId).toBe(user.id);
    expect(shop.businessName).toBe("Verified Dealer Biz");
  });

  it("creates a PENDING (inactive) staff account with no session", async () => {
    const email = mail("verify-staff");
    const mobile = mob("82");
    const code = await createOtp(email, "register", {
      kind: "staff",
      name: "Verified Staff",
      businessName: null,
      email,
      mobile,
      passwordHash: hashPassword(PASSWORD),
      gstNumber: null,
      shopAddress: null,
      role: "technician",
      shopId: dealerShopId,
    });
    const res = await request(app)
      .post("/api/auth/register/verify")
      .send({ email, code });
    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(true);
    expect(res.body.token).toBeUndefined();
    expect(res.body.message).toMatch(/pending approval/i);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    expect(user.isActive).toBe(false);
    expect(user.role).toBe("technician");
    expect(user.shopId).toBe(dealerShopId);

    // ...and the pending account cannot sign in yet
    const login = await request(app)
      .post("/api/auth/login")
      .send({ emailOrMobile: email, password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.message).toMatch(/pending/i);
  });

  it("rejects a wrong code (401) without creating an account", async () => {
    const email = mail("verify-wrong");
    await createOtp(email, "register", dealerOtpPayload(email, mob("83")));
    const res = await request(app)
      .post("/api/auth/register/verify")
      .send({ email, code: "000000" });
    expect(res.status).toBe(401);
    const rows = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
    expect(rows).toHaveLength(0);
  });

  it("re-checks uniqueness at verify time (409) if the account appeared meanwhile", async () => {
    const email = mail("verify-race");
    const code = await createOtp(email, "register", dealerOtpPayload(email, DEALER_MOBILE));
    const res = await request(app)
      .post("/api/auth/register/verify")
      .send({ email, code });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it("rejects staff verification when the shop no longer exists (404)", async () => {
    const email = mail("verify-noshop");
    const code = await createOtp(email, "register", {
      kind: "staff",
      name: "Orphan Staff",
      businessName: null,
      email,
      mobile: mob("84"),
      passwordHash: hashPassword(PASSWORD),
      gstNumber: null,
      shopAddress: null,
      role: "reception",
      shopId: "00000000-0000-0000-0000-000000000000",
    });
    const res = await request(app)
      .post("/api/auth/register/verify")
      .send({ email, code });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/no longer exists/i);
  });
});
