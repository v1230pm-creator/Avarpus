import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import {
  db,
  otpCodesTable,
  sessionsTable,
  shopMembershipsTable,
  shopsTable,
  usersTable,
} from "@workspace/db";
import { createSession, sha256 } from "../lib/authUtils";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerMobile = `8${suffix.replace(/\D/g, "").slice(-9).padStart(9, "1")}`;
const staffMobile = `7${suffix.replace(/\D/g, "").slice(-9).padStart(9, "2")}`;
const ownerEmail = `workspace-owner-${suffix}@standalone.local`;
const staffEmail = `workspace-staff-${suffix}@standalone.local`;
const businessEmail = `business-${suffix}@example.test`;
const verificationCode = "614209";
let ownerId = "";
let staffId = "";
let ownerToken = "";
let staffToken = "";
let shopId = "";
const extraUserIds: string[] = [];

describe.sequential("optional Shop workspace", () => {
  beforeAll(async () => {
    const [owner] = await db.insert(usersTable).values({
      name: "Personal Owner",
      email: ownerEmail,
      mobile: ownerMobile,
      role: "customer",
      isActive: true,
      passwordHash: null,
    }).returning();
    const [staff] = await db.insert(usersTable).values({
      name: "Personal Staff",
      email: staffEmail,
      mobile: staffMobile,
      role: "customer",
      isActive: true,
      passwordHash: null,
    }).returning();
    ownerId = owner.id;
    staffId = staff.id;
    ownerToken = await createSession(owner.id, true, "shop-test-owner");
    staffToken = await createSession(staff.id, true, "shop-test-staff");
  });

  afterAll(async () => {
    if (ownerId || staffId) {
      await db.delete(usersTable).where(inArray(usersTable.id, [ownerId, staffId, ...extraUserIds].filter(Boolean)));
    }
  });

  it("keeps a phone-only account personal before Shop setup", async () => {
    const response = await request(app).get("/api/shop/me").set("Authorization", `Bearer ${ownerToken}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ activeShopId: null, shop: null, memberships: [] });
  });

  it("creates the Shop only after a code bound to this personal account is verified", async () => {
    await db.insert(otpCodesTable).values({
      identifier: businessEmail,
      purpose: "business_setup",
      codeHash: sha256(verificationCode),
      payload: {
        userId: ownerId,
        businessName: "Verified Mobile Care",
        address: "12 Service Road",
        gstNumber: null,
      },
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const response = await request(app)
      .post("/api/shop/setup/verify")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: businessEmail, code: verificationCode });
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: ownerId, role: "dealer" });
    expect(response.body.shop).toMatchObject({
      businessName: "Verified Mobile Care",
      businessEmail,
      businessEmailVerified: true,
      role: "owner",
    });
    shopId = response.body.shop.id;
    const [membership] = await db.select().from(shopMembershipsTable).where(and(
      eq(shopMembershipsTable.shopId, shopId),
      eq(shopMembershipsTable.userId, ownerId),
    ));
    expect(membership).toMatchObject({ role: "owner", status: "active" });
  });

  it("connects an existing mobile-verified account through a one-time staff claim", async () => {
    const invite = await request(app)
      .post("/api/shop/invitations")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ mobile: staffMobile, role: "technician" });
    expect(invite.status).toBe(200);
    expect(invite.body.staffId).toMatch(/^STF-/);
    expect(invite.body.claimCode).toHaveLength(10);

    const claim = await request(app)
      .post("/api/shop/claim")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ staffId: invite.body.staffId, claimCode: invite.body.claimCode });
    expect(claim.status).toBe(200);
    expect(claim.body.user).toMatchObject({ id: staffId, role: "technician", shopId });

    const replay = await request(app)
      .post("/api/shop/claim")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ staffId: invite.body.staffId, claimCode: invite.body.claimCode });
    expect(replay.status).toBe(403);
  });

  it("detects and restores a business backup with mobile auth plus business email", async () => {
    await db.update(usersTable).set({ shopId: null }).where(eq(usersTable.id, staffId));
    const status = await request(app).get("/api/shop/me").set("Authorization", `Bearer ${staffToken}`);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ activeShopId: null, shop: null, backupDetected: true });

    const recoveryCode = "820461";
    await db.insert(otpCodesTable).values({
      identifier: businessEmail,
      purpose: "business_recovery",
      codeHash: sha256(recoveryCode),
      payload: { userId: staffId, shopId },
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const restored = await request(app)
      .post("/api/shop/recovery/verify")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ shopId, email: businessEmail, code: recoveryCode });
    expect(restored.status).toBe(200);
    expect(restored.body.user).toMatchObject({ id: staffId, shopId });
  });

  it("invalidates an older pending claim when the owner reissues it", async () => {
    const mobile = `6${suffix.replace(/\D/g, "").slice(-9).padStart(9, "3")}`;
    const [target] = await db.insert(usersTable).values({
      name: "Pending Personal Account",
      email: `pending-${suffix}@standalone.local`,
      mobile,
      role: "customer",
      isActive: true,
      passwordHash: null,
    }).returning();
    extraUserIds.push(target.id);
    const token = await createSession(target.id, true, "shop-test-pending");
    const first = await request(app).post("/api/shop/invitations")
      .set("Authorization", `Bearer ${ownerToken}`).send({ mobile, role: "reception" });
    const second = await request(app).post("/api/shop/invitations")
      .set("Authorization", `Bearer ${ownerToken}`).send({ mobile, role: "technician" });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const stale = await request(app).post("/api/shop/claim")
      .set("Authorization", `Bearer ${token}`)
      .send({ staffId: first.body.staffId, claimCode: first.body.claimCode });
    expect(stale.status).toBe(403);
    const current = await request(app).post("/api/shop/claim")
      .set("Authorization", `Bearer ${token}`)
      .send({ staffId: second.body.staffId, claimCode: second.body.claimCode });
    expect(current.status).toBe(200);
    expect(current.body.user.role).toBe("technician");
  });

  it("keeps the membership role after switching away and back", async () => {
    const [otherShop] = await db.insert(shopsTable).values({
      dealerId: ownerId,
      businessName: `Second Shop ${suffix}`,
    }).returning();
    await db.insert(shopMembershipsTable).values({
      shopId: otherShop.id,
      userId: staffId,
      role: "reception",
      status: "active",
    });
    await db.insert(shopMembershipsTable).values({
      shopId: otherShop.id,
      userId: ownerId,
      role: "owner",
      status: "active",
    });
    const changed = await request(app).patch(`/api/staff/${staffId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "accountant" });
    expect(changed.status).toBe(200);
    expect(changed.body.user.role).toBe("accountant");
    const shopAOverride = await request(app).put(`/api/staff/${staffId}/permissions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ features: { repairs: true } });
    expect(shopAOverride.status).toBe(200);
    await request(app).post("/api/shop/switch")
      .set("Authorization", `Bearer ${ownerToken}`).send({ shopId: otherShop.id });
    const shopBOverride = await request(app).put(`/api/staff/${staffId}/permissions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ features: { payments: false } });
    expect(shopBOverride.status).toBe(200);
    expect((await request(app).post("/api/shop/switch")
      .set("Authorization", `Bearer ${staffToken}`).send({ shopId: otherShop.id })).body.user.role).toBe("reception");
    const inShopB = await request(app).get("/api/role-features")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(inShopB.body.features.payments).toBe(false);
    expect((await request(app).post("/api/shop/switch")
      .set("Authorization", `Bearer ${staffToken}`).send({ shopId })).body.user.role).toBe("accountant");
    const inShopA = await request(app).get("/api/role-features")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(inShopA.body.features.repairs).toBe(true);
    await request(app).post("/api/shop/switch")
      .set("Authorization", `Bearer ${ownerToken}`).send({ shopId });
  });

  it("blocks invitations immediately after owner membership revocation", async () => {
    await db.update(shopMembershipsTable).set({ status: "revoked" }).where(and(
      eq(shopMembershipsTable.shopId, shopId),
      eq(shopMembershipsTable.userId, ownerId),
    ));
    const denied = await request(app).post("/api/shop/invitations")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ mobile: staffMobile, role: "technician" });
    expect(denied.status).toBe(403);
    await db.update(shopMembershipsTable).set({ status: "active" }).where(and(
      eq(shopMembershipsTable.shopId, shopId),
      eq(shopMembershipsTable.userId, ownerId),
    ));
  });
});