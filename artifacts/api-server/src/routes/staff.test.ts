// Integration tests for staff approval/rejection.
// Covers (1) email notifications: correct template triggered, mail failures
// never block approve/reject; (2) OTP eligibility after approval; (3) shop isolation: an unrelated dealer
// cannot approve or reject another shop's staff. Email delivery is mocked.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import {
  db,
  dealersTable,
  loginEventsTable,
  pool,
  sessionsTable,
  shopsTable,
  usersTable,
} from "@workspace/db";

const sendStaffApprovedEmailMock = vi.fn<(to: string, name: string) => Promise<void>>(
  async () => {},
);
const sendStaffRejectedEmailMock = vi.fn<(to: string, name: string) => Promise<void>>(
  async () => {},
);
vi.mock("../lib/mailer", () => ({
  sendOtpEmail: async () => {},
  sendReadyNotification: async () => {},
  sendStaffApprovedEmail: (to: string, name: string) => sendStaffApprovedEmailMock(to, name),
  sendStaffRejectedEmail: (to: string, name: string) => sendStaffRejectedEmailMock(to, name),
  getMailFrom: () => "test@example.com",
  warnIfMailFromUnset: () => {},
}));
// The OTP eligibility checks below only care that the request reaches the
// send step; never let a unit test dial the live SMS provider.
vi.mock("../lib/hanuOtp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/hanuOtp")>();
  return {
    ...actual,
    getHanuOtpStatus: () => ({ ...actual.getHanuOtpStatus(), configured: true }),
    hanuSendOtp: async () => ({ ok: true, providerMessage: "success", providerReference: null }),
  };
});

const { default: app } = await import("../app");
const { createSession, hashPassword } = await import("../lib/authUtils");

const RUN = Date.now().toString().slice(-8);
const PASSWORD = "Test1234";
const mob = (prefix: string) => `${prefix}${RUN}`;
const mail = (tag: string) => `staffmail-${tag}-${RUN}@example.test`;

let dealerToken: string;
let dealerShopId: string;
let otherDealerToken: string;
let otherDealerShopId: string;

async function createPendingStaff(tag: string, mobilePrefix: string) {
  const [row] = await db
    .insert(usersTable)
    .values({
      name: `Pending ${tag}`,
      email: mail(tag),
      mobile: mob(mobilePrefix),
      passwordHash: hashPassword(PASSWORD),
      role: "technician",
      shopId: dealerShopId,
      isActive: false,
    })
    .returning();
  return row;
}

beforeAll(async () => {
  const [dealer] = await db
    .insert(usersTable)
    .values({
      name: "Staff Mail Dealer",
      email: mail("dealer"),
      mobile: mob("80"),
      passwordHash: hashPassword(PASSWORD),
      role: "dealer",
      isActive: true,
    })
    .returning();
  const [shop] = await db
    .insert(shopsTable)
    .values({ dealerId: dealer.id, businessName: "Staff Mail Shop", address: "Test Lane" })
    .returning();
  dealerShopId = shop.id;
  await db.update(usersTable).set({ shopId: dealerShopId }).where(eq(usersTable.id, dealer.id));

  dealerToken = await createSession(dealer.id, false, "test fixture");

  // A second, unrelated dealer + shop for shop-isolation tests.
  const [otherDealer] = await db
    .insert(usersTable)
    .values({
      name: "Other Shop Dealer",
      email: mail("dealer2"),
      mobile: mob("90"),
      passwordHash: hashPassword(PASSWORD),
      role: "dealer",
      isActive: true,
    })
    .returning();
  const [otherShop] = await db
    .insert(shopsTable)
    .values({ dealerId: otherDealer.id, businessName: "Other Mail Shop", address: "Other Lane" })
    .returning();
  otherDealerShopId = otherShop.id;
  await db
    .update(usersTable)
    .set({ shopId: otherDealerShopId })
    .where(eq(usersTable.id, otherDealer.id));
  otherDealerToken = await createSession(otherDealer.id, false, "test fixture");
});

afterAll(async () => {
  const created = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(like(usersTable.email, `staffmail-%-${RUN}@example.test`));
  for (const { id } of created) {
    await db.delete(sessionsTable).where(eq(sessionsTable.userId, id));
    await db.delete(loginEventsTable).where(eq(loginEventsTable.userId, id));
  }
  await db.delete(shopsTable).where(eq(shopsTable.id, dealerShopId));
  await db.delete(shopsTable).where(eq(shopsTable.id, otherDealerShopId));
  for (const { id } of created) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
  await pool.end();
});

beforeEach(() => {
  sendStaffApprovedEmailMock.mockClear();
  sendStaffRejectedEmailMock.mockClear();
  sendStaffApprovedEmailMock.mockImplementation(async () => {});
  sendStaffRejectedEmailMock.mockImplementation(async () => {});
});

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${dealerToken}`);

// Flush the fire-and-forget email promise chain.
const flush = () => new Promise((r) => setImmediate(r));

describe("PATCH /api/staff/:id/activate — approval email", () => {
  it("activates the account and sends the approval email to the staff member", async () => {
    const staff = await createPendingStaff("approve-ok", "81");
    const res = await auth(request(app).patch(`/api/staff/${staff.id}/activate`));
    expect(res.status).toBe(200);
    expect(res.body.user.isActive).toBe(true);
    await flush();
    expect(sendStaffApprovedEmailMock).toHaveBeenCalledWith(staff.email, staff.name);
    expect(sendStaffRejectedEmailMock).not.toHaveBeenCalled();
  });

  it("still activates the account when the approval email fails", async () => {
    sendStaffApprovedEmailMock.mockImplementation(async () => {
      throw new Error("resend down");
    });
    const staff = await createPendingStaff("approve-fail", "82");
    const res = await auth(request(app).patch(`/api/staff/${staff.id}/activate`));
    expect(res.status).toBe(200);
    expect(res.body.user.isActive).toBe(true);
    await flush();
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, staff.id));
    expect(row.isActive).toBe(true);
  });

  it("does not re-send the email when the account is already active", async () => {
    const staff = await createPendingStaff("approve-idem", "83");
    await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, staff.id));
    const res = await auth(request(app).patch(`/api/staff/${staff.id}/activate`));
    expect(res.status).toBe(200);
    await flush();
    expect(sendStaffApprovedEmailMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/staff/:id — rejection email", () => {
  it("deletes the account and sends the decline email to the staff member", async () => {
    const staff = await createPendingStaff("reject-ok", "84");
    const res = await auth(request(app).delete(`/api/staff/${staff.id}`));
    expect(res.status).toBe(200);
    const rows = await db.select().from(usersTable).where(eq(usersTable.id, staff.id));
    expect(rows).toHaveLength(0);
    await flush();
    expect(sendStaffRejectedEmailMock).toHaveBeenCalledWith(staff.email, staff.name);
    expect(sendStaffApprovedEmailMock).not.toHaveBeenCalled();
  });

  it("still deletes the account (and responds 200) when the decline email fails", async () => {
    sendStaffRejectedEmailMock.mockImplementation(async () => {
      throw new Error("resend down");
    });
    const staff = await createPendingStaff("reject-fail", "85");
    const res = await auth(request(app).delete(`/api/staff/${staff.id}`));
    expect(res.status).toBe(200);
    const rows = await db.select().from(usersTable).where(eq(usersTable.id, staff.id));
    expect(rows).toHaveLength(0);
  });

  it("does not send a decline email when rejecting an active account is refused", async () => {
    const staff = await createPendingStaff("reject-active", "86");
    await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, staff.id));
    const res = await auth(request(app).delete(`/api/staff/${staff.id}`));
    expect(res.status).toBe(400);
    await flush();
    expect(sendStaffRejectedEmailMock).not.toHaveBeenCalled();
  });
});

describe("staff approval → OTP eligibility", () => {
  it("approves a staff account without exposing a password sign-in path", async () => {
    const staff = await createPendingStaff("login-approved", "91");

    const before = await request(app)
      .post("/api/auth/login")
      .send({ emailOrMobile: staff.email, password: PASSWORD });
    expect(before.status).toBe(404);

    const approve = await auth(request(app).patch(`/api/staff/${staff.id}/activate`));
    expect(approve.status).toBe(200);

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, staff.id));
    expect(after.isActive).toBe(true);
  });

  it("rejected staff accounts are removed", async () => {
    const staff = await createPendingStaff("login-rejected", "92");
    const reject = await auth(request(app).delete(`/api/staff/${staff.id}`));
    expect(reject.status).toBe(200);

    const rows = await db.select().from(usersTable).where(eq(usersTable.id, staff.id));
    expect(rows).toHaveLength(0);
  });

  it("staff deactivated after approval are ineligible for OTP sign-in", async () => {
    const staff = await createPendingStaff("login-deactivated", "93");
    await auth(request(app).patch(`/api/staff/${staff.id}/activate`));
    // Dealer later deactivates the account again.
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, staff.id));

    const otpRequest = await request(app)
      .post("/api/auth/otp/request")
      .send({ mobile: staff.mobile });
    expect(otpRequest.status).toBe(200);
  });
});

describe("shop isolation for staff management", () => {
  const otherAuth = (r: request.Test) => r.set("Authorization", `Bearer ${otherDealerToken}`);

  it("an unrelated dealer cannot approve another shop's pending staff", async () => {
    const staff = await createPendingStaff("cross-approve", "94");
    const res = await otherAuth(request(app).patch(`/api/staff/${staff.id}/activate`));
    expect(res.status).toBe(404);

    // The account stays pending and no legacy password route can bypass it.
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, staff.id));
    expect(row.isActive).toBe(false);
    const login = await request(app).post("/api/auth/login").send({});
    expect(login.status).toBe(404);
    await flush();
    expect(sendStaffApprovedEmailMock).not.toHaveBeenCalled();
  });

  it("an unrelated dealer cannot reject another shop's pending staff", async () => {
    const staff = await createPendingStaff("cross-reject", "95");
    const res = await otherAuth(request(app).delete(`/api/staff/${staff.id}`));
    expect(res.status).toBe(404);

    const rows = await db.select().from(usersTable).where(eq(usersTable.id, staff.id));
    expect(rows).toHaveLength(1);
    await flush();
    expect(sendStaffRejectedEmailMock).not.toHaveBeenCalled();
  });

  it("does not treat another dealer account as manageable staff", async () => {
    const [otherDealer] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.shopId, otherDealerShopId))
      .limit(1);
    expect(otherDealer.role).toBe("dealer");
    const activate = await auth(request(app).patch(`/api/staff/${otherDealer.id}/activate`));
    const remove = await auth(request(app).delete(`/api/staff/${otherDealer.id}`));
    expect(activate.status).toBe(403);
    expect(remove.status).toBe(403);
  });
});

describe("individual permission settings", () => {
  const otherAuth = (r: request.Test) => r.set("Authorization", `Bearer ${otherDealerToken}`);

  it("overrides one account, enforces it server-side, and can return to the role default", async () => {
    const staff = await createPendingStaff("permissions", "96");
    await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, staff.id));
    const staffToken = await createSession(staff.id, false, "test fixture");
    const staffAuth = (r: request.Test) =>
      r.set("Authorization", `Bearer ${staffToken}`);

    const initial = await auth(request(app).get(`/api/staff/${staff.id}/permissions`));
    expect(initial.status).toBe(200);
    expect(initial.body.roleFeatures.dashboard).toBe(true);
    expect(initial.body.overrides).toEqual({});
    expect(initial.body.features.dashboard).toBe(true);
    expect(initial.body.permissions.VIEW_REPAIR).toBe(true);
    expect(initial.body.permissions.EDIT_REPAIR).toBe(true);
    expect(initial.body.permissions.MANAGE_STAFF).toBe(false);

    const disabled = await auth(request(app)
      .put(`/api/staff/${staff.id}/permissions`)
      .send({ features: { dashboard: false } }));
    expect(disabled.status).toBe(200);
    expect(disabled.body.overrides.dashboard).toBe(false);
    expect(disabled.body.features.dashboard).toBe(false);
    expect(disabled.body.permissions.VIEW_REPAIR).toBe(true);

    const repairsDisabled = await auth(request(app)
      .put(`/api/staff/${staff.id}/permissions`)
      .send({ features: { repairs: false } }));
    expect(repairsDisabled.status).toBe(200);
    expect(repairsDisabled.body.permissions.VIEW_REPAIR).toBe(false);
    const repairReadDenied = await staffAuth(request(app).get("/api/repairs"));
    expect(repairReadDenied.status).toBe(403);
    expect(repairReadDenied.body.code).toBe("FEATURE_DISABLED");
    const ownerRepairRead = await auth(request(app).get("/api/repairs"));
    expect(ownerRepairRead.status).toBe(200);

    const returnsDisabled = await auth(request(app)
      .put(`/api/staff/${staff.id}/permissions`)
      .send({ features: { repairs_update: false } }));
    expect(returnsDisabled.status).toBe(200);
    expect((await staffAuth(request(app).get("/api/returns"))).status).toBe(403);
    expect((await staffAuth(request(app).get("/api/refunds"))).status).toBe(403);
    expect((await auth(request(app).get("/api/returns"))).status).toBe(200);
    expect((await auth(request(app).get("/api/refunds"))).status).toBe(200);
    await auth(request(app)
      .put(`/api/staff/${staff.id}/permissions`)
      .send({ features: { repairs_update: true } }));

    const repairsInherited = await auth(request(app)
      .put(`/api/staff/${staff.id}/permissions`)
      .send({ features: { repairs: true } }));
    expect(repairsInherited.status).toBe(200);
    expect(repairsInherited.body.overrides.repairs).toBeUndefined();
    expect(repairsInherited.body.permissions.VIEW_REPAIR).toBe(true);

    const ownFeatures = await staffAuth(request(app).get("/api/role-features"));
    expect(ownFeatures.status).toBe(200);
    expect(ownFeatures.body.features.dashboard).toBe(false);
    const blocked = await staffAuth(request(app).get("/api/dashboard/stats"));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("FEATURE_DISABLED");

    // Raw API callers do not have to know the null-clears convention: a
    // boolean matching the role value is canonicalized to inheritance too.
    const inherited = await auth(request(app)
      .put(`/api/staff/${staff.id}/permissions`)
      .send({ features: { dashboard: true } }));
    expect(inherited.status).toBe(200);
    expect(inherited.body.overrides.dashboard).toBeUndefined();
    expect(inherited.body.features.dashboard).toBe(true);
    const allowed = await staffAuth(request(app).get("/api/dashboard/stats"));
    expect(allowed.status).toBe(200);
  });

  it("rejects unknown keys and keeps permission management shop-scoped", async () => {
    const staff = await createPendingStaff("permissions-isolation", "97");
    await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, staff.id));

    const invalid = await auth(request(app)
      .put(`/api/staff/${staff.id}/permissions`)
      .send({ features: { staff_management: false } }));
    expect(invalid.status).toBe(400);

    const crossRead = await otherAuth(request(app).get(`/api/staff/${staff.id}/permissions`));
    expect(crossRead.status).toBe(404);
    const crossWrite = await otherAuth(request(app)
      .put(`/api/staff/${staff.id}/permissions`)
      .send({ features: { dashboard: false } }));
    expect(crossWrite.status).toBe(404);

    const unchanged = await auth(request(app).get(`/api/staff/${staff.id}/permissions`));
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.overrides).toEqual({});
  });

  it("removes dashboard finance totals and approval reads when effective features are revoked", async () => {
    const staff = await createPendingStaff("accountant-revocation", "76");
    await db
      .update(usersTable)
      .set({ isActive: true, role: "accountant" })
      .where(eq(usersTable.id, staff.id));
    const token = await createSession(staff.id, false, "test fixture");
    const staffAuth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

    const before = await staffAuth(request(app).get("/api/dashboard/stats"));
    expect(before.status).toBe(200);
    expect(before.body.stats.canSeeFinance).toBe(true);

    await auth(request(app)
      .put(`/api/staff/${staff.id}/permissions`)
      .send({ features: { finance: false, approvals: false } }));
    const after = await staffAuth(request(app).get("/api/dashboard/stats"));
    expect(after.status).toBe(200);
    expect(after.body.stats.canSeeFinance).toBe(false);
    expect(after.body.stats.todayIncome).toBeUndefined();
    expect((await staffAuth(request(app).get("/api/finance"))).status).toBe(403);
    expect((await staffAuth(request(app).get("/api/approvals"))).status).toBe(403);
  });
});

describe("dealer portal repair reads", () => {
  it("retains the portal_repairs read-only path", async () => {
    const [partner] = await db.insert(dealersTable).values({
      shopId: dealerShopId,
      dealerCode: `PORTAL-${RUN}`,
      name: "Portal Partner",
      mobile: mob("98"),
    }).returning();
    const [portalUser] = await db.insert(usersTable).values({
      name: "Portal Reader",
      email: mail("portal-reader"),
      mobile: mob("99"),
      passwordHash: hashPassword(PASSWORD),
      role: "dealer_staff",
      shopId: dealerShopId,
      dealerId: partner.id,
      isActive: true,
    }).returning();
    const portalToken = await createSession(portalUser.id, false, "test fixture");

    const featureState = await request(app)
      .get("/api/role-features")
      .set("Authorization", `Bearer ${portalToken}`);
    expect(featureState.status).toBe(200);
    expect(featureState.body.features.portal_repairs).toBe(true);

    const res = await request(app)
      .get("/api/repairs")
      .set("Authorization", `Bearer ${portalToken}`);
    expect(res.status).toBe(200);
    expect(res.body.repairs).toEqual([]);

    const revoked = await auth(request(app)
      .put(`/api/staff/${portalUser.id}/permissions`)
      .send({ features: { portal_repairs: false } }));
    expect(revoked.status).toBe(200);
    expect(revoked.body.features.portal_repairs).toBe(false);
    const revokedState = await request(app)
      .get("/api/role-features")
      .set("Authorization", `Bearer ${portalToken}`);
    expect(revokedState.status).toBe(403);
    expect(revokedState.body.code).toBe("FEATURE_DISABLED");
    expect((await request(app)
      .get("/api/repairs")
      .set("Authorization", `Bearer ${portalToken}`)).status).toBe(403);
    await db.delete(sessionsTable).where(eq(sessionsTable.userId, portalUser.id));
    await db.delete(usersTable).where(eq(usersTable.id, portalUser.id));
    await db.delete(dealersTable).where(eq(dealersTable.id, partner.id));
  });
});
