import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  appSettingsTable,
  usersTable,
  SUPPORT_NOTIFICATION_EMAIL_KEY,
  CHAT_RELAY_CLEANUP_ENABLED_KEY,
  CHAT_RELAY_EXPIRY_DAYS_KEY,
  CHAT_RELAY_GRACE_DAYS_KEY,
} from "@workspace/db";
import {
  ChatRelaySettingsUpdateBody,
  SupportNotificationSettingsUpdateBody,
} from "@workspace/api-zod";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { isMailSenderConfigured } from "../lib/mailer";
import {
  readChatRelayLastRun,
  readChatRelayPolicy,
  readMinimumSupportedAppBuild,
  runChatRelayCleanup,
} from "../lib/chatRelayCleanup";
import { readChatRelayHistory } from "../lib/chatRelayHistory";
import {
  CHAT_RELAY_MIN_APP_BUILD,
  chatRelayEnableBlockedReason,
  validateChatRelayPolicyUpdate,
} from "../lib/chatRelayPolicy";
import { StorageSweepsDisabledError } from "../lib/storageSweeps";

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

// ── Chat media relay policy ─────────────────────────────────────────────────

async function readChatRelaySettingsView() {
  const [policy, minimumSupportedBuild, lastRun, [meta]] = await Promise.all([
    readChatRelayPolicy(),
    readMinimumSupportedAppBuild(),
    readChatRelayLastRun(),
    db
      .select({ updatedAt: appSettingsTable.updatedAt, updatedByName: usersTable.name })
      .from(appSettingsTable)
      .leftJoin(usersTable, eq(appSettingsTable.updatedBy, usersTable.id))
      .where(inArray(appSettingsTable.key, [CHAT_RELAY_CLEANUP_ENABLED_KEY]))
      .limit(1),
  ]);
  const enableBlockedReason = chatRelayEnableBlockedReason(minimumSupportedBuild);
  return {
    enabled: policy.enabled,
    graceDays: policy.graceDays,
    expiryDays: policy.expiryDays,
    requiredAppBuild: CHAT_RELAY_MIN_APP_BUILD,
    minimumSupportedBuild,
    canEnable: enableBlockedReason === null,
    enableBlockedReason,
    updatedAt: meta?.updatedAt ?? null,
    updatedByName: meta?.updatedByName ?? null,
    lastRun: lastRun
      ? {
          ranAt: lastRun.ranAt,
          skipped: lastRun.skipped,
          skippedReason: lastRun.skippedReason,
          examined: lastRun.examined,
          purged: lastRun.purged,
          expired: lastRun.expired,
          alreadyGone: lastRun.alreadyGone,
          tombstonesPurged: lastRun.tombstonesPurged ?? 0,
          kept: lastRun.kept,
          failed: lastRun.failed,
          bytesReclaimed: lastRun.bytesReclaimed,
          abortedError: lastRun.abortedError,
        }
      : null,
  };
}

router.get(
  "/settings/chat-relay",
  requireAuth,
  ADMIN,
  asyncHandler(async (_req, res) => {
    res.json(await readChatRelaySettingsView());
  }),
);

router.put(
  "/settings/chat-relay",
  requireAuth,
  ADMIN,
  asyncHandler(async (req, res) => {
    const parsed = ChatRelaySettingsUpdateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid relay settings." });
      return;
    }
    const validated = validateChatRelayPolicyUpdate(parsed.data);
    if (!validated.ok) {
      res.status(400).json({ message: validated.message });
      return;
    }
    const { policy } = validated;
    // Rollout guard: the purge may only be switched on once every supported
    // install keeps its own media copies. Turning it OFF is always allowed.
    if (policy.enabled) {
      const blocked = chatRelayEnableBlockedReason(await readMinimumSupportedAppBuild());
      if (blocked) {
        res.status(409).json({ message: blocked, code: "CHAT_RELAY_MIN_BUILD_NOT_MET" });
        return;
      }
    }

    const now = new Date();
    const values = [
      { key: CHAT_RELAY_CLEANUP_ENABLED_KEY, value: policy.enabled ? "true" : "false" },
      { key: CHAT_RELAY_GRACE_DAYS_KEY, value: String(policy.graceDays) },
      { key: CHAT_RELAY_EXPIRY_DAYS_KEY, value: String(policy.expiryDays) },
    ];
    await db.transaction(async (tx) => {
      for (const entry of values) {
        await tx
          .insert(appSettingsTable)
          .values({ ...entry, updatedBy: req.user!.id, updatedAt: now })
          .onConflictDoUpdate({
            target: appSettingsTable.key,
            set: { value: entry.value, updatedBy: req.user!.id, updatedAt: now },
          });
      }
    });

    res.json(await readChatRelaySettingsView());
  }),
);

// Runs one purge cycle now (bounded exactly like the daily run) and reports
// what it reclaimed. Honours the switch and the build guard like the timer.
router.post(
  "/settings/chat-relay/run",
  requireAuth,
  ADMIN,
  asyncHandler(async (_req, res) => {
    let result;
    try {
      result = await runChatRelayCleanup({ trigger: "manual" });
    } catch (error) {
      // This server's database does not own the shared bucket (development
      // workspace, a VPS before migration): nothing was touched.
      if (error instanceof StorageSweepsDisabledError) {
        res.status(409).json({ code: "STORAGE_SWEEPS_DISABLED", message: error.message });
        return;
      }
      throw error;
    }
    res.json({
      result: {
        ranAt: result.ranAt,
        skipped: result.skipped,
        skippedReason: result.skippedReason,
        examined: result.examined,
        purged: result.purged,
        expired: result.expired,
        alreadyGone: result.alreadyGone,
        tombstonesPurged: result.tombstonesPurged,
        kept: result.kept,
        failed: result.failed,
        bytesReclaimed: result.bytesReclaimed,
        abortedError: result.abortedError,
      },
      settings: await readChatRelaySettingsView(),
    });
  }),
);

// Bounded history of whole-relay runs plus what the relay holds right now.
// The console derives the trend from it (bytes reclaimed per day, purged vs
// expired share, relay size after each run).
router.get(
  "/settings/chat-relay/history",
  requireAuth,
  ADMIN,
  asyncHandler(async (_req, res) => {
    res.json(await readChatRelayHistory());
  }),
);

export default router;
