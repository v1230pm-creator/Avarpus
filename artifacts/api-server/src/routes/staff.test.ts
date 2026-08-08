// Integration tests for staff approval/rejection email notifications.
// Verifies the correct email/template is triggered and that mail failures
// never block the approve/reject actions. Email delivery is mocked.
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
