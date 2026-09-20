import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  notificationsTable,
  resendWebhookEventsTable,
  usersTable,
} from "@workspace/db";
import { dispatchPushToUsers } from "../lib/push";
import { shopOwnerUserIds } from "../lib/shopOwners";
import { maskEmail } from "../lib/authUtils";

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const TRACKED_EVENT_TYPES = new Set([
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
  "email.delivery_delayed",
]);
const FAILURE_EVENT_TYPES = new Set([
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
]);
const VERIFICATION_EMAIL_KINDS = new Set([
  "registration_verification",
  "estimate_approval_verification",
  "delivery_confirmation_verification",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ResendWebhookPayload = {
  type?: unknown;
  created_at?: unknown;
  data?: {
    email_id?: unknown;
    to?: unknown;
    tags?: unknown;
    bounce?: { message?: unknown; diagnosticCode?: unknown };
    failure?: { message?: unknown };
    error?: { message?: unknown };
    message?: unknown;
  };
};

function stringValue(value: unknown, maxLength = 500): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function getTags(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, tagValue]) => {
      const normalized = stringValue(tagValue, 200);
      return normalized ? [[key, normalized]] : [];
    }),
  );
}

function failureReason(eventType: string, data: ResendWebhookPayload["data"]): string | null {
  if (eventType === "email.complained") return "Recipient marked the email as spam";
  if (eventType === "email.delivery_delayed") return "Delivery was delayed by the receiving email service";
  return (
    stringValue(data?.bounce?.message) ??
    stringValue(data?.failure?.message) ??
    stringValue(data?.error?.message) ??
    stringValue(data?.message) ??
    (FAILURE_EVENT_TYPES.has(eventType) ? "Delivery was rejected by the email service" : null)
  );
}

function signatureIsValid(rawBody: Buffer, headers: { id?: string; timestamp?: string; signature?: string }): boolean {
  const secret = process.env["RESEND_WEBHOOK_SECRET"];
  if (!secret?.startsWith("whsec_") || !headers.id || !headers.timestamp || !headers.signature) {
    return false;
  }

  const timestamp = Number(headers.timestamp);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }

  let key: Buffer;
  try {
    key = Buffer.from(secret.slice("whsec_".length), "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody.toString("utf8")}`)
    .digest("base64");

  return headers.signature
    .split(" ")
    .filter((part) => part.startsWith("v1,"))
    .some((part) => {
      const candidate = Buffer.from(part.slice(3));
      return candidate.length === Buffer.byteLength(expected) &&
        timingSafeEqual(candidate, Buffer.from(expected));
    });
}

export const resendWebhookHandler: RequestHandler = (req, res, next) => {
  void (async () => {
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).json({ message: "Invalid webhook payload" });
      return;
    }

    const headers = {
      id: req.header("svix-id") ?? req.header("webhook-id") ?? undefined,
      timestamp: req.header("svix-timestamp") ?? req.header("webhook-timestamp") ?? undefined,
      signature: req.header("svix-signature") ?? req.header("webhook-signature") ?? undefined,
    };
    if (!process.env["RESEND_WEBHOOK_SECRET"]) {
      req.log.error("RESEND_WEBHOOK_SECRET is not configured; refusing Resend webhook");
      res.status(503).json({ message: "Webhook endpoint is not configured" });
      return;
    }
    if (!signatureIsValid(rawBody, headers)) {
      res.status(400).json({ message: "Invalid webhook signature" });
      return;
    }

    let payload: ResendWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as ResendWebhookPayload;
    } catch {
      res.status(400).json({ message: "Invalid webhook payload" });
      return;
    }

    const eventType = stringValue(payload.type, 100);
    const providerEventId = headers.id;
    const recipient = Array.isArray(payload.data?.to)
      ? stringValue(payload.data?.to.find((value): value is string => typeof value === "string"), 320)
      : null;
    if (!eventType || !providerEventId || !recipient || !TRACKED_EVENT_TYPES.has(eventType)) {
      // A verified but irrelevant event should not be retried by the provider.
      res.status(204).end();
      return;
    }

    const tags = getTags(payload.data?.tags);
    const taggedShopId = tags["avarpus_shop_id"];
    const shopId = taggedShopId && UUID_RE.test(taggedShopId) ? taggedShopId : null;
    const isVerificationEmail = VERIFICATION_EMAIL_KINDS.has(tags["avarpus_email_kind"] ?? "");
    const occurredAtInput = stringValue(payload.created_at, 80);
    const occurredAt = occurredAtInput ? new Date(occurredAtInput) : new Date();
    const safeOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
    const reason = failureReason(eventType, payload.data);
    const resendEmailId = stringValue(payload.data?.email_id, 160);

    type OwnerAlert = { userIds: string[]; title: string; body: string; data: Record<string, unknown> };
    const outcome = await db.transaction(async (tx): Promise<{ created: boolean; alert: OwnerAlert | null }> => {
      const inserted = await tx
        .insert(resendWebhookEventsTable)
        .values({
          providerEventId,
          resendEmailId,
          eventType,
          recipient,
          failureReason: reason,
          shopId,
          occurredAt: safeOccurredAt,
        })
        .onConflictDoNothing({ target: resendWebhookEventsTable.providerEventId })
        .returning({ id: resendWebhookEventsTable.id });
      if (!inserted[0]) return { created: false, alert: null };
      if (!shopId || !isVerificationEmail || !FAILURE_EVENT_TYPES.has(eventType)) {
        return { created: true, alert: null };
      }

      const owners = (await shopOwnerUserIds(shopId, { executor: tx })).map((id) => ({ id }));
      if (owners.length === 0) return { created: true, alert: null };

      const title = "Verification email could not be delivered";
      const body = `Registration verification email to ${recipient} was not delivered${reason ? `: ${reason}` : ""}`;
      const data = { recipient, reason, eventType };
      await tx.insert(notificationsTable).values(
        owners.map((owner) => ({
          shopId,
          userId: owner.id,
          type: "verification_email_delivery_failed",
          title,
          body,
          data,
        })),
      );
      // Push goes out after the transaction commits, with the row's own
      // wording, so a rolled-back insert never leaves a delivered alert behind.
      return {
        created: true,
        alert: { userIds: owners.map((owner) => owner.id), title, body, data },
      };
    });

    if (outcome.alert) {
      dispatchPushToUsers(outcome.alert.userIds, {
        type: "verification_email_delivery_failed",
        title: outcome.alert.title,
        body: outcome.alert.body,
        data: outcome.alert.data,
      });
    }

    req.log.info(
      { eventType, recipient: maskEmail(recipient), duplicate: !outcome.created },
      "Resend delivery webhook processed",
    );
    res.status(204).end();
  })().catch(next);
};