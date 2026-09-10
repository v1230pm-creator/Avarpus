import { eq } from "drizzle-orm";
import {
  db,
  appSettingsTable,
  SUPPORT_NOTIFICATION_EMAIL_KEY,
} from "@workspace/db";
import { sendPublicRequestAlertEmail } from "./mailer";

export async function getSupportNotificationRecipient(): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, SUPPORT_NOTIFICATION_EMAIL_KEY))
    .limit(1);
  const value = row?.value.trim();
  return value ? value : null;
}

/**
 * Emails the configured operator inbox that a new public request arrived.
 * Fire-and-forget: the requester's 202 must never depend on mail delivery,
 * and a mail outage must never lose the request, which is already persisted.
 */
export function dispatchPublicRequestAlert(d: {
  kind: string;
  requesterName: string;
  mobile: string;
  email: string | null;
  subject: string | null;
  message: string;
}): void {
  // Standalone integration checks exercise the real public endpoint against
  // the database, but must never contact the configured operator inbox.
  if (process.env.DISABLE_PUBLIC_REQUEST_ALERTS === "true") return;

  void (async () => {
    try {
      const to = await getSupportNotificationRecipient();
      if (!to) return;
      await sendPublicRequestAlertEmail(to, {
        kindLabel:
          d.kind === "account_deletion"
            ? "Account deletion request"
            : "Support request",
        requesterName: d.requesterName,
        mobile: d.mobile,
        email: d.email,
        subject: d.subject,
        message: d.message,
      });
    } catch (error) {
      console.error("[publicRequests] alert email failed", error);
    }
  })();
}
