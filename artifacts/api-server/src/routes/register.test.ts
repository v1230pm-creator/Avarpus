import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, sessionsTable, shopsTable, usersTable } from "@workspace/db";

vi.mock("../lib/mailer", () => ({
  sendOtpEmail: vi.fn(async () => "test-message"),
  getMailFrom: () => "test@example.com",
  warnIfMailFromUnset: () => {},
}));

const { default: app } = await import("../app");
const { createOtp } = await import("../lib/authUtils");

const RUN = Date.now().toString().slice(-9);
const createdUserIds: string[] = [];

function dealerPayload(suffix: string) {
  return {
    name: `Dealer ${suffix}`,
    businessName: `Shop ${suffix}`,
    email: `registration-${suffix}-${RUN}@example.test`,
    mobile: `8${RUN}`,
    shopAddress: "1 Main Street",
  };
}

afterAll(async () => {
  for (const id of createdUserIds) {
    await db.delete(shopsTable).where(eq(shopsTable.dealerId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

describe("public registration", () => {
  it("requires dealer business details", async () => {
    const { businessName, ...payload } = dealerPayload("missing-business");
    const res = await request(app).post("/api/auth/register/start").send(payload);
    expect(res.status).toBe(400);
  });

  it("rejects staff and privileged role claims", async () => {
    for (const role of ["reception", "technician", "super_admin"]) {
      const res = await request(app)
        .post("/api/auth/register/start")
        .send({ ...dealerPayload(`blocked-${role}`), role });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/dealer accounts/i);
    }
  });

  it("does not require or persist a registration password", async () => {
    const payload = dealerPayload("password-ignored");
    const res = await request(app)
      .post("/api/auth/register/start")
      .send({ ...payload, password: "AnyOldPassword1" });
    expect(res.status).toBe(200);
  });

  it("creates a dealer and shop after email OTP verification without a session", async () => {
    const payload = dealerPayload("verify");
    const code = await createOtp(payload.email, "register", {
      kind: "dealer",
      name: payload.name,
      businessName: payload.businessName,
      email: payload.email,
      mobile: payload.mobile,
      gstNumber: null,
      shopAddress: payload.shopAddress,
      role: "dealer",
    });

    const res = await request(app)
      .post("/api/auth/register/verify")
      .send({ email: payload.email, code });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user.role).toBe("dealer");
    expect(res.body.message).toMatch(/mobile OTP/i);
    createdUserIds.push(res.body.user.id);

    const sessions = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, res.body.user.id));
    expect(sessions).toHaveLength(0);

    const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.dealerId, res.body.user.id));
    expect(shop).toBeTruthy();
  });
});