import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  appSettingsTable,
  usersTable,
  SUPPORT_NOTIFICATION_EMAIL_KEY,
} from "@workspace/db";
import { SupportNotificationSettingsUpdateBody } from "@workspace/api-zod";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { isMailSenderConfigured } from "../lib/mailer";

const router: IRouter = Router();
const ADMIN = requireRole("super_admin");

// Deliberately conservative: one address, no display name, no comma lists.
// A malformed recipient silently breaks every alert, so reject early.
const EMAIL_PATTERN = /^[^\s@,<>]+@[^\s@,<>.]+(\.[^\s@,<>.]+)+$/;

async function readSupportNotificationSettings() {
  const [row] = await db
    .select({
      value: appSettingsTable.value,
      updatedAt: appSettingsTable.updatedAt,
      updatedByName: usersTable.name,
    })
    .from(appSettingsTable)
    .leftJoin(usersTable, eq(appSettingsTable.updatedBy, usersTable.id))
    .where(eq(appSettingsTable.key, SUPPORT_NOTIFICATION_EMAIL_KEY))
    .limit(1);

  const recipientEmail = row?.value.trim() ? row.value.trim() : null;
  return {
    recipientEmail,
    updatedAt: row?.updatedAt ?? null,
    updatedByName: recipientEmail ? (row?.updatedByName ?? null) : null,
    senderConfigured: isMailSenderConfigured(),
  };
}

// Unauthenticated: the website renders this on its public support page. Only
// the operator-configured support address is exposed — never requester data,
// reviewer identities, or any other setting.
router.get(
  "/public/contact",
  asyncHandler(async (_req, res) => {
    const [row] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, SUPPORT_NOTIFICATION_EMAIL_KEY))
      .limit(1);
    const supportEmail = row?.value.trim() ? row.value.trim() : null;
    res.json({ supportEmail });
  }),
);

router.get(
  "/settings/support-notifications",
  requireAuth,
  ADMIN,
  asyncHandler(async (_req, res) => {
    res.json(await readSupportNotificationSettings());
  }),
);

router.put(
  "/settings/support-notifications",
  requireAuth,
  ADMIN,
  asyncHandler(async (req, res) => {
    const parsed = SupportNotificationSettingsUpdateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Enter a valid email address." });
      return;
    }
    const raw = (parsed.data.recipientEmail ?? "").trim();
    if (raw && (raw.length > 254 || !EMAIL_PATTERN.test(raw))) {
      res.status(400).json({ message: "Enter a valid email address." });
      return;
    }

    await db
      .insert(appSettingsTable)
      .values({
        key: SUPPORT_NOTIFICATION_EMAIL_KEY,
        value: raw,
        updatedBy: req.user!.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value: raw, updatedBy: req.user!.id, updatedAt: new Date() },
      });

    res.json(await readSupportNotificationSettings());
  }),
);

export default router;
