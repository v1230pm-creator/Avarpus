import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { shopsTable } from "./auth";

// Minimal, safe receipt of provider delivery events. We intentionally retain
// only the recipient and provider-supplied failure reason — never email bodies,
// subjects, OTPs, or the raw webhook payload.
export const resendWebhookEventsTable = pgTable(
  "resend_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerEventId: text("provider_event_id").notNull(),
    resendEmailId: text("resend_email_id"),
    eventType: text("event_type").notNull(),
    recipient: text("recipient").notNull(),
    failureReason: text("failure_reason"),
    shopId: uuid("shop_id").references(() => shopsTable.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("resend_webhook_events_provider_event_id_unique").on(t.providerEventId),
    index("resend_webhook_events_shop_occurred_idx").on(t.shopId, t.occurredAt),
  ],
);