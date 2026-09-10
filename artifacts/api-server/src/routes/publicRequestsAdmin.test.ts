import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  publicRequestIdentityVerificationsTable,
  publicRequestTransitionsTable,
  publicRequestsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession } from "../lib/authUtils";

const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const createdRequestIds: string[] = [];
const createdUserIds: string[] = [];
let adminToken = "";
let dealerToken = "";
let firstRequestId = "";
let deletionRequestId = "";
let inactiveAdminId = "";
let dealerId = "";

describe.sequential("public request admin queue", () => {
  beforeAll(async () => {
    const [admin] = await db.insert(usersTable).values({
      name: "Request Queue Admin",
      email: `request-admin-${suffix}@example.test`,
      mobile: `80${suffix.replace(/\D/g, "").slice(-8).padStart(8, "1")}`,
      role: "super_admin",
      isActive: true,
    }).returning();
    const [inactiveAdmin] = await db.insert(usersTable).values({
      name: "Inactive Request Queue Admin",
      email: `inactive-request-admin-${suffix}@example.test`,
      mobile: `82${suffix.replace(/\D/g, "").slice(-8).padStart(8, "3")}`,
      role: "super_admin",
      isActive: false,
    }).returning();
    inactiveAdminId = inactiveAdmin.id;
    const [dealer] = await db.insert(usersTable).values({
      name: "Request Queue Dealer",
      email: `request-dealer-${suffix}@example.test`,
      mobile: `81${suffix.replace(/\D/g, "").slice(-8).padStart(8, "2")}`,
      role: "dealer",
      isActive: true,
    }).returning();
    dealerId = dealer.id;
    createdUserIds.push(admin.id, dealer.id, inactiveAdmin.id);
    adminToken = await createSession(admin.id, false, "request-admin-test");
    dealerToken = await createSession(dealer.id, false, "request-dealer-test");
    const requests = await db.insert(publicRequestsTable).values([
      {
        kind: "support",
        requesterName: "Queue Search One",
        mobile: "9876543210",
        message: "A support request used for queue authorization tests.",
        ipHash: `test-request-ip-${suffix}-1`,
      },
      {
        kind: "account_deletion",
        requesterName: "Queue Search Two",
        mobile: "9876543211",
        message: "An account deletion request that remains verification first.",
        ipHash: `test-request-ip-${suffix}-2`,
        confirmationAcceptedAt: new Date(),
      },
    ]).returning();
    createdRequestIds.push(...requests.map((row) => row.id));
    firstRequestId = requests[0].id;
    deletionRequestId = requests[1].id;
  });

  afterAll(async () => {
    if (createdRequestIds.length) {
      const alertRows = await db
        .select({ id: notificationsTable.id, data: notificationsTable.data })
        .from(notificationsTable)
        .where(eq(notificationsTable.type, "public_request_received"));
      const alertIds = alertRows
        .filter((row) =>
          createdRequestIds.includes(
            (row.data as { publicRequestId?: string }).publicRequestId ?? "",
          )
        )
        .map((row) => row.id);
      if (alertIds.length) {
        await db.delete(notificationsTable).where(inArray(notificationsTable.id, alertIds));
      }
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.allow_public_request_audit_cleanup', 'on', true)`);
        await tx.delete(publicRequestIdentityVerificationsTable).where(
          inArray(publicRequestIdentityVerificationsTable.publicRequestId, createdRequestIds),
        );
        await tx.delete(publicRequestTransitionsTable).where(
          inArray(publicRequestTransitionsTable.publicRequestId, createdRequestIds),
        );
        await tx.delete(publicRequestsTable).where(inArray(publicRequestsTable.id, createdRequestIds));
      });
    }
    if (createdUserIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
  });

  it("requires authentication and a super_admin role", async () => {
    expect((await request(app).get("/api/public/requests/admin")).status).toBe(401);
    expect((await request(app).get("/api/public/requests/admin")
      .set("Authorization", `Bearer ${dealerToken}`)).status).toBe(403);
  });

  it("filters and paginates without exposing the IP hash", async () => {
    const page = await request(app).get("/api/public/requests/admin?limit=1&search=Queue%20Search")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(page.status).toBe(200);
    expect(page.body.requests).toHaveLength(1);
    expect(page.body.requests[0]).not.toHaveProperty("ipHash");
    expect(Object.keys(page.body.requests[0]).sort()).toEqual([
      "createdAt", "id", "kind", "mobile", "requesterName", "status", "subject",
    ]);
    expect(page.body.nextCursor).toEqual(expect.any(String));

    const filtered = await request(app).get("/api/public/requests/admin?kind=support&status=received")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.requests).toHaveLength(1);
    expect(filtered.body.requests[0].kind).toBe("support");

    const bounded = await request(app).get("/api/public/requests/admin?limit=101")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(bounded.status).toBe(400);
  });

  it("returns generic 404s for malformed request identifiers", async () => {
    expect((await request(app).get("/api/public/requests/admin/not-a-uuid")
      .set("Authorization", `Bearer ${adminToken}`)).status).toBe(404);
    expect((await request(app).patch("/api/public/requests/admin/not-a-uuid/status")
      .set("Authorization", `Bearer ${adminToken}`).send({ status: "in_review" })).status).toBe(404);
    expect((await request(app).post("/api/public/requests/admin/not-a-uuid/identity-verification")
      .set("Authorization", `Bearer ${adminToken}`).send({ method: "OTP", note: "Confirmed safely" })).status).toBe(404);
  });

  it("attributes append-only review history and rejects repeats or terminal reopening", async () => {
    const inReview = await request(app)
      .patch(`/api/public/requests/admin/${firstRequestId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "in_review", note: "Verification started" });
    expect(inReview.status).toBe(200);
    expect(inReview.body.request.status).toBe("in_review");
    expect(inReview.body.request.reviewerUserId).toBeTruthy();
    expect(inReview.body.transitions).toHaveLength(1);
    expect(inReview.body.transitions[0]).toMatchObject({
      fromStatus: "received",
      toStatus: "in_review",
      note: "Verification started",
    });

    const detail = await request(app).get(`/api/public/requests/admin/${firstRequestId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body).not.toHaveProperty("ipHash");
    expect(detail.body.transitions[0].reviewerUserId).toBe(inReview.body.request.reviewerUserId);

    expect((await request(app).patch(`/api/public/requests/admin/${firstRequestId}/status`)
      .set("Authorization", `Bearer ${adminToken}`).send({ status: "in_review" })).status).toBe(409);
    expect((await request(app).patch(`/api/public/requests/admin/${firstRequestId}/status`)
      .set("Authorization", `Bearer ${adminToken}`).send({ status: "resolved" })).status).toBe(200);
    expect((await request(app).patch(`/api/public/requests/admin/${firstRequestId}/status`)
      .set("Authorization", `Bearer ${adminToken}`).send({ status: "in_review" })).status).toBe(409);
  });

  it("retains account-deletion identity verification confirmation", async () => {
    const response = await request(app).post("/api/public/requests").send({
      kind: "account_deletion",
      name: "Deletion Requester",
      mobile: "9876543212",
      message: "Please consider my account deletion request safely.",
      confirmation: false,
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("identity verification");
  });

  it("alerts only active super administrators after successful intake with minimal metadata", async () => {
    const expectedRecipients = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(sql`${usersTable.role} = 'super_admin' AND ${usersTable.isActive} = true`);
    const response = await request(app).post("/api/public/requests").send({
      kind: "account_deletion",
      name: "Private Deletion Requester",
      mobile: `83${suffix.replace(/\D/g, "").slice(-8).padStart(8, "4")}`,
      email: `private-deletion-${suffix}@example.test`,
      message: "Sensitive deletion details must never appear in an alert.",
      confirmation: true,
    });
    expect(response.status).toBe(202);
    createdRequestIds.push(response.body.requestId);

    let matching: Array<typeof notificationsTable.$inferSelect> = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const rows = await db
        .select()
        .from(notificationsTable)
        .where(eq(notificationsTable.type, "public_request_received"));
      matching = rows.filter((row) =>
        (row.data as { publicRequestId?: string }).publicRequestId === response.body.requestId
      );
      if (matching.length === expectedRecipients.length) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(matching.map((row) => row.userId).sort()).toEqual(
      expectedRecipients.map((row) => row.id).sort(),
    );
    expect(matching.map((row) => row.userId)).not.toContain(inactiveAdminId);
    expect(matching.map((row) => row.userId)).not.toContain(dealerId);
    for (const notification of matching) {
      expect(notification.shopId).toBeNull();
      expect(notification.title).toBe("Account deletion request received");
      expect(notification.body).not.toContain("Sensitive deletion details");
      expect(notification.data).toEqual({
        publicRequestId: response.body.requestId,
        kind: "account_deletion",
        href: `/public-requests/${response.body.requestId}`,
      });
    }
  });

  it("requires in-review deletion verification before resolution and makes audit records immutable", async () => {
    // A support request can never receive a deletion identity verification.
    expect((await request(app)
      .post(`/api/public/requests/admin/${firstRequestId}/identity-verification`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ method: "Government ID", note: "Checked identity documents" })).status).toBe(409);

    // Confirmation from the public form is not a verification record.
    expect((await request(app)
      .post(`/api/public/requests/admin/${deletionRequestId}/identity-verification`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ method: "Government ID", note: "Checked identity documents" })).status).toBe(409);
    expect((await request(app)
      .patch(`/api/public/requests/admin/${deletionRequestId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "in_review" })).status).toBe(200);
    expect((await request(app)
      .post(`/api/public/requests/admin/${deletionRequestId}/identity-verification`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ method: "  ", note: "  " })).status).toBe(400);
    expect((await request(app)
      .post(`/api/public/requests/admin/${deletionRequestId}/identity-verification`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ method: " A ", note: " Valid evidence " })).status).toBe(400);
    expect((await request(app)
      .patch(`/api/public/requests/admin/${deletionRequestId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "resolved" })).status).toBe(409);

    const verified = await request(app)
      .post(`/api/public/requests/admin/${deletionRequestId}/identity-verification`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ method: "Government ID", note: "Photo ID and OTP ownership confirmed" });
    expect(verified.status).toBe(200);
    expect(verified.body.identityVerification).toMatchObject({
      reviewerUserId: expect.any(String),
      reviewerName: "Request Queue Admin",
      method: "Government ID",
    });
    expect((await request(app)
      .post(`/api/public/requests/admin/${deletionRequestId}/identity-verification`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ method: "Government ID", note: "A duplicate should be rejected" })).status).toBe(409);
    expect((await request(app)
      .patch(`/api/public/requests/admin/${deletionRequestId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "resolved" })).status).toBe(200);

    await expect(db.update(publicRequestTransitionsTable)
      .set({ note: "tampered" })
      .where(inArray(publicRequestTransitionsTable.publicRequestId, [firstRequestId])))
      .rejects.toThrow();
    await expect(db.delete(publicRequestIdentityVerificationsTable)
      .where(eq(publicRequestIdentityVerificationsTable.publicRequestId, deletionRequestId)))
      .rejects.toThrow();
  });
});