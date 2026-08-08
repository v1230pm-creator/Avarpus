// Integration tests: purchase & finance endpoints must reject dates that are
// not valid YYYY-MM-DD calendar dates or that are in the future.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  financeEntriesTable,
  pool,
  purchasesTable,
  sessionsTable,
  shopsTable,
  usersTable,
} from "@workspace/db";

vi.mock("../lib/mailer", () => ({
  sendOtpEmail: vi.fn(async () => {}),
  getMailFrom: () => "test@example.com",
  warnIfMailFromUnset: () => {},
}));

const { default: app } = await import("../app");
const { createSession, hashPassword } = await import("../lib/authUtils");

const RUN = Date.now().toString().slice(-9);
const EMAIL = `datetest-${RUN}@example.test`;
const MOBILE = `8${RUN}`;

let userId: string;
let shopId: string;
let token: string;

const todayStr = () => new Date().toISOString().split("T")[0];
const futureStr = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 5);
  return d.toISOString().split("T")[0];
};

beforeAll(async () => {
  const [u] = await db
    .insert(usersTable)
    .values({
      name: "Date Test Dealer",
      email: EMAIL,
      mobile: MOBILE,
      passwordHash: hashPassword("Test1234!"),
      role: "dealer",
      isActive: true,
    })
    .returning();
  userId = u.id;
  const [shop] = await db
    .insert(shopsTable)
    .values({ dealerId: userId, businessName: "Date Test Shop" })
    .returning();
  shopId = shop.id;
  await db.update(usersTable).set({ shopId }).where(eq(usersTable.id, userId));
  token = await createSession(userId);
});

afterAll(async () => {
  await db.delete(purchasesTable).where(eq(purchasesTable.shopId, shopId));
  await db.delete(financeEntriesTable).where(eq(financeEntriesTable.shopId, shopId));
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
  await db.delete(shopsTable).where(eq(shopsTable.id, shopId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await pool.end();
});

const auth = { Authorization: "" };
beforeAll(() => {
  auth.Authorization = `Bearer ${token}`;
});

const BAD_DATES: [string, unknown][] = [
  ["empty string", ""],
  ["whitespace", "   "],
  ["non-string", 123],
  ["wrong format", "08/08/2026"],
  ["impossible calendar date", "2026-02-30"],
  ["future date", futureStr()],
];

describe("purchase date validation", () => {
  it.each(BAD_DATES)("POST /api/purchases rejects %s", async (_label, date) => {
    const res = await request(app)
      .post("/api/purchases")
      .set(auth)
      .send({ supplier: "S", itemName: "I", date });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATE");
    expect(typeof res.body.message).toBe("string");
  });

  it("POST /api/purchases accepts today's date and defaults when omitted", async () => {
    const withDate = await request(app)
      .post("/api/purchases")
      .set(auth)
      .send({ supplier: "S", itemName: "I", date: todayStr() });
    expect(withDate.status).toBe(200);
    expect(withDate.body.purchase.date).toBe(todayStr());

    const omitted = await request(app)
      .post("/api/purchases")
      .set(auth)
      .send({ supplier: "S", itemName: "I" });
    expect(omitted.status).toBe(200);
    expect(omitted.body.purchase.date).toBe(todayStr());
  });

  it.each(BAD_DATES)("PATCH /api/purchases/:id rejects %s", async (_label, date) => {
    const created = await request(app)
      .post("/api/purchases")
      .set(auth)
      .send({ supplier: "S", itemName: "I" });
    const res = await request(app)
      .patch(`/api/purchases/${created.body.purchase.id}`)
      .set(auth)
      .send({ date });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATE");
  });
});

describe("finance date validation", () => {
  it.each(BAD_DATES)("POST /api/finance rejects %s", async (_label, date) => {
    const res = await request(app)
      .post("/api/finance")
      .set(auth)
      .send({ type: "income", category: "Sales", amount: 10, date });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATE");
  });

  it("POST /api/finance accepts today's date and defaults when omitted", async () => {
    const withDate = await request(app)
      .post("/api/finance")
      .set(auth)
      .send({ type: "income", category: "Sales", amount: 10, date: todayStr() });
    expect(withDate.status).toBe(200);
    expect(withDate.body.entry.date).toBe(todayStr());

    const omitted = await request(app)
      .post("/api/finance")
      .set(auth)
      .send({ type: "expense", category: "Rent", amount: 5 });
    expect(omitted.status).toBe(200);
    expect(omitted.body.entry.date).toBe(todayStr());
  });

  it.each(BAD_DATES)("PATCH /api/finance/:id rejects %s", async (_label, date) => {
    const created = await request(app)
      .post("/api/finance")
      .set(auth)
      .send({ type: "income", category: "Sales", amount: 10 });
    const res = await request(app)
      .patch(`/api/finance/${created.body.entry.id}`)
      .set(auth)
      .send({ date });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATE");
  });
});
