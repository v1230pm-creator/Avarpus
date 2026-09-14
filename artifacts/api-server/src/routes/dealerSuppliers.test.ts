// A B2B dealer filed by shop A (by mobile) who also runs their OWN shop must
// see A's repairs for them from inside that business account — and nobody
// else's. Also covers the portal-login → own-shop graduation path.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import {
  db,
  dealersTable,
  otpCodesTable,
  repairsTable,
  roleFeatureSettingsTable,
  shopsTable,
  usersTable,
} from "@workspace/db";
import { createSession, sha256 } from "../lib/authUtils";
import { invalidateRoleFeatureCache } from "../lib/roleFeatures";

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9);
let seq = 0;
// Distinct 10-digit mobiles per run; the leading 6 keeps clear of other suites.
const uniqMob = () => `6${RUN.slice(-6)}${(seq++).toString().padStart(3, "0")}`;
const email = (tag: string) => `suppliers-${tag}-${RUN}@example.test`;
const today = () => new Date().toISOString().slice(0, 10);

const dealerMobile = uniqMob();          // X: the person filed as a dealer
const strangerMobile = uniqMob();        // Z: another dealer at shop A

let supplierOwnerId = "";  // A: owner of the supplier shop
let supplierShopId = "";
let supplierOwnerToken = "";
let xId = "";               // X: starts as dealer_owner (portal) at shop A
let xToken = "";
let xShopId = "";
let bystanderId = "";       // Y: unrelated shop owner
let bystanderToken = "";
let xDealerRowId = "";
let strangerDealerRowId = "";
let xOwnRowId = "";
const repairIds: string[] = [];
const verificationCode = "731904";
const businessEmail = email("x-business");

async function seedRepair(shopId: string, dealerId: string | null, customerName: string, extra: Partial<typeof repairsTable.$inferInsert> = {}) {
  const [row] = await db.insert(repairsTable).values({
    shopId,
    repairId: `SUP-${RUN}-${repairIds.length + 1}`,
    customerName,
    mobile: dealerMobile,
    deviceType: "Phone",
    brand: "Pixel",
    model: `M${repairIds.length + 1}`,
    problem: "Screen cracked",
    receiveDate: today(),
    expectedDate: today(),
    dealerId,
    dealerName: dealerId ? "X Traders" : null,
    repairCharge: 1000,
    partsCharge: 500,
    advance: 300,
    notes: "internal only",
    ...extra,
  }).returning();
  repairIds.push(row.id);
  return row;
}

describe.sequential("dealer supplier view", () => {
  beforeAll(async () => {
    const [a] = await db.insert(usersTable).values({
      name: "Supplier Owner", email: email("a"), mobile: uniqMob(), role: "dealer", isActive: true, passwordHash: null,
    }).returning();
    supplierOwnerId = a.id;
    const [shopA] = await db.insert(shopsTable).values({
      dealerId: a.id, businessName: "A Mobile Care", address: "1 Market Road",
    }).returning();
    supplierShopId = shopA.id;
    await db.update(usersTable).set({ shopId: shopA.id }).where(eq(usersTable.id, a.id));
    supplierOwnerToken = await createSession(a.id, false, "suppliers-a");

    // Shop A files X with a human-formatted number; matching must normalise.
    const [xRow] = await db.insert(dealersTable).values({
      shopId: shopA.id, dealerCode: `DLR-${RUN}-X`, name: "X Traders",
      mobile: `+91 ${dealerMobile.slice(0, 5)}-${dealerMobile.slice(5)}`,
    }).returning();
    xDealerRowId = xRow.id;
    const [zRow] = await db.insert(dealersTable).values({
      shopId: shopA.id, dealerCode: `DLR-${RUN}-Z`, name: "Z Traders", mobile: strangerMobile,
    }).returning();
    strangerDealerRowId = zRow.id;

    await seedRepair(shopA.id, xRow.id, "X Traders");
    await seedRepair(shopA.id, xRow.id, "X Traders", { status: "ready" });
    await seedRepair(shopA.id, zRow.id, "Z Traders");
    await seedRepair(shopA.id, null, "Walk-in");

    // X logged in via OTP earlier and was shaped as a dealer-portal login.
    const [x] = await db.insert(usersTable).values({
      name: "X Owner", email: email("x"), mobile: dealerMobile, role: "dealer_owner",
      shopId: shopA.id, dealerId: xRow.id, isActive: true, passwordHash: null,
    }).returning();
    xId = x.id;
    xToken = await createSession(x.id, false, "suppliers-x");

    const [y] = await db.insert(usersTable).values({
      name: "Bystander", email: email("y"), mobile: uniqMob(), role: "dealer", isActive: true, passwordHash: null,
    }).returning();
    bystanderId = y.id;
    const [shopY] = await db.insert(shopsTable).values({ dealerId: y.id, businessName: "Y Repairs", address: "9 Side St" }).returning();
    await db.update(usersTable).set({ shopId: shopY.id }).where(eq(usersTable.id, y.id));
    bystanderToken = await createSession(y.id, false, "suppliers-y");
  });

  afterAll(async () => {
    if (repairIds.length) await db.delete(repairsTable).where(inArray(repairsTable.id, repairIds));
    const ids = [supplierOwnerId, xId, bystanderId].filter(Boolean);
    // Shops cascade dealers, repairs and feature settings.
    if (ids.length) await db.delete(shopsTable).where(inArray(shopsTable.dealerId, ids));
    if (ids.length) await db.delete(usersTable).where(inArray(usersTable.id, ids));
  });

  it("keeps the supplier view closed to portal logins (they have /dealers/me)", async () => {
    const res = await request(app).get("/api/dealers/suppliers").set("Authorization", `Bearer ${xToken}`);
    expect(res.status).toBe(403);
  });

  it("lets a portal login open its own Shop, even while the supplier has it switched off", async () => {
    const me = await request(app).get("/api/shop/me").set("Authorization", `Bearer ${xToken}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ shop: null, memberships: [] });

    // Supplier deactivates X's dealer row: portal data closes, own-Shop setup does not.
    await db.update(dealersTable).set({ isActive: false }).where(eq(dealersTable.id, xDealerRowId));
    const closed = await request(app).get("/api/repairs").set("Authorization", `Bearer ${xToken}`);
    expect(closed.status).toBe(403);
    expect(closed.body.code).toBe("DEALER_INACTIVE");
    const stillOpen = await request(app).get("/api/shop/me").set("Authorization", `Bearer ${xToken}`);
    expect(stillOpen.status).toBe(200);
    await db.update(dealersTable).set({ isActive: true }).where(eq(dealersTable.id, xDealerRowId));

    await db.insert(otpCodesTable).values({
      identifier: businessEmail,
      purpose: "business_setup",
      codeHash: sha256(verificationCode),
      payload: { userId: xId, businessName: "X Traders Pvt", address: "5 Lane", gstNumber: null },
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const res = await request(app)
      .post("/api/shop/setup/verify")
      .set("Authorization", `Bearer ${xToken}`)
      .send({ email: businessEmail, code: verificationCode });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: xId, role: "dealer" });
    xShopId = res.body.shop.id;
    expect(xShopId).not.toBe(supplierShopId);

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, xId));
    expect(row).toMatchObject({ role: "dealer", shopId: xShopId, dealerId: null });

    // X's own shop also lists X's number as a "dealer" — that is not a supplier.
    const [own] = await db.insert(dealersTable).values({
      shopId: xShopId, dealerCode: `DLR-${RUN}-SELF`, name: "Myself", mobile: dealerMobile,
    }).returning();
    xOwnRowId = own.id;
  });

  it("lists only other shops that file the caller's verified mobile", async () => {
    const res = await request(app).get("/api/dealers/suppliers").set("Authorization", `Bearer ${xToken}`);
    expect(res.status).toBe(200);
    expect(res.body.suppliers).toHaveLength(1);
    const [link] = res.body.suppliers;
    expect(link).toMatchObject({
      dealerId: xDealerRowId,
      dealerCode: `DLR-${RUN}-X`,
      dealerName: "X Traders",
      shopId: supplierShopId,
      supplier: { businessName: "A Mobile Care", ownerName: "Supplier Owner" },
    });
    expect(link.stats).toMatchObject({ totalRepairs: 2, ready: 1 });
    expect(res.body.suppliers.map((s: { dealerId: string }) => s.dealerId)).not.toContain(xOwnRowId);

    const other = await request(app).get("/api/dealers/suppliers").set("Authorization", `Bearer ${bystanderToken}`);
    expect(other.status).toBe(200);
    expect(other.body.suppliers).toEqual([]);
  });

  it("returns the supplier's repairs for the caller's record only, portal-projected", async () => {
    const res = await request(app)
      .get(`/api/dealers/suppliers/${xDealerRowId}/repairs`)
      .set("Authorization", `Bearer ${xToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.repairs).toHaveLength(2);
    for (const r of res.body.repairs) {
      expect(r.dealerName).toBe("X Traders");
      expect(r.totalAmount).toBe(1500);
      expect(r.paidAmount).toBe(300);
      expect(r.balance).toBe(1200);
      expect(r.paymentStatus).toBe("partial");
      expect(r).not.toHaveProperty("notes");
      expect(r).not.toHaveProperty("technicianId");
      expect(r).not.toHaveProperty("shopId");
    }
    const ready = await request(app)
      .get(`/api/dealers/suppliers/${xDealerRowId}/repairs?status=ready`)
      .set("Authorization", `Bearer ${xToken}`);
    expect(ready.status).toBe(200);
    expect(ready.body.total).toBe(1);
    expect(ready.body.repairs[0].status).toBe("ready");
  });

  it("hides other dealers' records and the caller's own-shop row", async () => {
    for (const [token, dealerRow] of [
      [xToken, strangerDealerRowId],
      [xToken, xOwnRowId],
      [bystanderToken, xDealerRowId],
    ] as const) {
      const res = await request(app)
        .get(`/api/dealers/suppliers/${dealerRow}/repairs`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(404);
    }
  });

  it("honours the supplier shop's dealer-portal switch", async () => {
    await db.insert(roleFeatureSettingsTable).values({
      shopId: supplierShopId, role: "dealer_owner", features: { portal_repairs: false },
    });
    invalidateRoleFeatureCache(supplierShopId);
    const list = await request(app).get("/api/dealers/suppliers").set("Authorization", `Bearer ${xToken}`);
    expect(list.status).toBe(200);
    expect(list.body.suppliers).toEqual([]);
    const repairs = await request(app)
      .get(`/api/dealers/suppliers/${xDealerRowId}/repairs`)
      .set("Authorization", `Bearer ${xToken}`);
    expect(repairs.status).toBe(404);

    await db.delete(roleFeatureSettingsTable).where(eq(roleFeatureSettingsTable.shopId, supplierShopId));
    invalidateRoleFeatureCache(supplierShopId);
  });

  it("drops the link once the supplier deactivates the dealer record", async () => {
    const off = await request(app)
      .patch(`/api/dealers/${xDealerRowId}`)
      .set("Authorization", `Bearer ${supplierOwnerToken}`)
      .send({ isActive: false });
    expect(off.status).toBe(200);
    const list = await request(app).get("/api/dealers/suppliers").set("Authorization", `Bearer ${xToken}`);
    expect(list.body.suppliers).toEqual([]);
    const repairs = await request(app)
      .get(`/api/dealers/suppliers/${xDealerRowId}/repairs`)
      .set("Authorization", `Bearer ${xToken}`);
    expect(repairs.status).toBe(404);
  });
});
