import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  db,
  notificationsTable,
  pool,
  resendWebhookEventsTable,
  shopsTable,
  usersTable,
} from "@workspace/db";

const WEBHOOK_SECRET = "whsec_dGVzdC1yZXNlbmQtd2ViaG9vay1zZWNyZXQ=";
process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;

const { default: app } = await import("../app");

const RUN = Date.now().toString().slice(-8);
const recipient = `webhook-${RUN}@example.test`;
let dealerId: string;
let shopId: string;

function signedHeaders(body: string, id: string, timestamp = Math.floor(Date.now() / 1000).toString()) {
  const key = Buffer.from(WEBHOOK_SECRET.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
    "Content-Type": "application/json",
  };
}

async function postEvent(
  id: string,
  type: string,
  options: { tags?: Record<string, string>; bounceMessage?: string } = {},
) {
  const body = JSON.stringify({
    type,
    created_at: new Date().toISOString(),
    data: {
      email_id: `email-${id}`,
      to: [recipient],
      tags: options.tags ?? {},
      ...(options.bounceMessage ? { bounce: { message: options.bounceMessage } } : {}),
    },
  });
  return request(app)
    .post("/api/webhooks/resend")
    .set(signedHeaders(body, id))
    .send(body);
}

beforeAll(async () => {
  const [dealer] = await db.insert(usersTable).values({
    name: "Webhook Test Owner",
    email: `webhook-owner-${RUN}@example.test`,
    mobile: `61${RUN}`,
    passwordHash: "not-used",
    role: "dealer",
    isActive: true,
  }).returning();
  dealerId = dealer.id;
  const [shop] = await db.insert(shopsTable).values({
    dealerId,
    businessName: "Webhook Test Shop",
    address: "Test Lane",
  }).returning();
  shopId = shop.id;
  await db.update(usersTable).set({ shopId }).where(eq(usersTable.id, dealerId));
});

afterAll(async () => {
  await db.delete(shopsTable).where(eq(shopsTable.id, shopId));
  await db.update(usersTable).set({ shopId: null }).where(eq(usersTable.id, dealerId));
  await db.delete(usersTable).where(eq(usersTable.id, dealerId));
  await pool.end();
});

describe("POST /api/webhooks/resend", () => {
  it("records signed delivery, bounce, and complaint events without retaining message content", async () => {
    const estimateTags = {
      avarpus_email_kind: "registration_verification",
      avarpus_shop_id: shopId,
    };
    estimateTags.avarpus_email_kind = "estimate_approval_verification";
    expect((await postEvent(`msg-delivered-${RUN}`, "email.delivered", { tags: estimateTags })).status).toBe(204);
    expect((await postEvent(`msg-bounced-${RUN}`, "email.bounced", {
      tags: estimateTags,
      bounceMessage: "Recipient mailbox does not exist",
    })).status).toBe(204);
    expect((await postEvent(`msg-complained-${RUN}`, "email.complained", {
      tags: {
        avarpus_email_kind: "delivery_confirmation_verification",
        avarpus_shop_id: shopId,
      },
    })).status).toBe(204);

    const events = await db
      .select()
      .from(resendWebhookEventsTable)
      .where(eq(resendWebhookEventsTable.shopId, shopId));
    expect(events.map((event) => event.eventType).sort()).toEqual([
      "email.bounced",
      "email.complained",
      "email.delivered",
    ]);
    expect(events.find((event) => event.eventType === "email.bounced")?.failureReason)
      .toBe("Recipient mailbox does not exist");
    expect(events.every((event) => event.recipient === recipient)).toBe(true);

    const alerts = await db
      .select()
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.shopId, shopId),
        eq(notificationsTable.type, "verification_email_delivery_failed"),
      ));
    expect(alerts).toHaveLength(2);
    expect(alerts[0]?.body).toContain(recipient);
    expect(alerts[0]?.data).not.toHaveProperty("code");
  });

  it("does not duplicate a delivery failure alert when Resend retries the same event", async () => {
    const id = `msg-retry-${RUN}`;
    const options = {
      tags: {
        avarpus_email_kind: "delivery_confirmation_verification",
        avarpus_shop_id: shopId,
      },
      bounceMessage: "Mailbox unavailable",
    };
    expect((await postEvent(id, "email.bounced", options)).status).toBe(204);
    expect((await postEvent(id, "email.bounced", options)).status).toBe(204);

    const events = await db
      .select()
      .from(resendWebhookEventsTable)
      .where(eq(resendWebhookEventsTable.providerEventId, id));
    expect(events).toHaveLength(1);
    const alerts = await db
      .select()
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.shopId, shopId),
        eq(notificationsTable.type, "verification_email_delivery_failed"),
      ));
    expect(alerts).toHaveLength(3);
  });

  it("rejects forged requests before storing an event", async () => {
    const body = JSON.stringify({
      type: "email.bounced",
      data: { to: [recipient] },
    });
    const res = await request(app)
      .post("/api/webhooks/resend")
      .set({
        "svix-id": `msg-forged-${RUN}`,
        "svix-timestamp": Math.floor(Date.now() / 1000).toString(),
        "svix-signature": "v1,not-a-valid-signature",
        "Content-Type": "application/json",
      })
      .send(body);
    expect(res.status).toBe(400);
    const events = await db
      .select()
      .from(resendWebhookEventsTable)
      .where(eq(resendWebhookEventsTable.providerEventId, `msg-forged-${RUN}`));
    expect(events).toHaveLength(0);
  });
});