// Integration tests for staff approval/rejection.
// Covers (1) email notifications: correct template triggered, mail failures
// never block approve/reject; (2) login outcomes: approved staff can sign in,
// pending/rejected staff cannot; (3) shop isolation: an unrelated dealer
// cannot approve or reject another shop's staff. Email delivery is mocked.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import {
  db,
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

const { default: app } = await import("../app");
const { hashPassword } = await import("../lib/authUtils");

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

  const login = await request(app)
    .post("/api/auth/login")
    .send({ emailOrMobile: mail("dealer"), password: PASSWORD });
  expect(login.status).toBe(200);
  dealerToken = login.body.token;

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
  const otherLogin = await request(app)
    .post("/api/auth/login")
    .send({ emailOrMobile: mail("dealer2"), password: PASSWORD });
  expect(otherLogin.status).toBe(200);
  otherDealerToken = otherLogin.body.token;
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

describe("staff approval → login outcomes", () => {
  it("approved staff can sign in", async () => {
    const staff = await createPendingStaff("login-approved", "91");

    // Sanity: pending accounts are locked out with 403.
    const before = await request(app)
      .post("/api/auth/login")
      .send({ emailOrMobile: staff.email, password: PASSWORD });
    expect(before.status).toBe(403);
    expect(before.body.message).toMatch(/pending/i);

    const approve = await auth(request(app).patch(`/api/staff/${staff.id}/activate`));
    expect(approve.status).toBe(200);

    const after = await request(app)
      .post("/api/auth/login")
      .send({ emailOrMobile: staff.email, password: PASSWORD });
    expect(after.status).toBe(200);
    expect(typeof after.body.token).toBe("string");
    expect(after.body.user.id).toBe(staff.id);
    expect(after.body.user.isActive).toBe(true);
  });

  it("rejected staff cannot sign in (account removed)", async () => {
    const staff = await createPendingStaff("login-rejected", "92");
    const reject = await auth(request(app).delete(`/api/staff/${staff.id}`));
    expect(reject.status).toBe(200);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ emailOrMobile: staff.email, password: PASSWORD });
    expect(login.status).toBe(401);
    expect(login.body.token).toBeUndefined();
  });

  it("staff deactivated after approval cannot sign in", async () => {
    const staff = await createPendingStaff("login-deactivated", "93");
    await auth(request(app).patch(`/api/staff/${staff.id}/activate`));
    // Dealer later deactivates the account again.
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, staff.id));

    const login = await request(app)
      .post("/api/auth/login")
      .send({ emailOrMobile: staff.email, password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.token).toBeUndefined();
  });
});

describe("shop isolation for staff management", () => {
  const otherAuth = (r: request.Test) => r.set("Authorization", `Bearer ${otherDealerToken}`);

  it("an unrelated dealer cannot approve another shop's pending staff", async () => {
    const staff = await createPendingStaff("cross-approve", "94");
    const res = await otherAuth(request(app).patch(`/api/staff/${staff.id}/activate`));
    expect(res.status).toBe(404);

    // The account stays pending and still cannot sign in.
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, staff.id));
    expect(row.isActive).toBe(false);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ emailOrMobile: staff.email, password: PASSWORD });
    expect(login.status).toBe(403);
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
});
