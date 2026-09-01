import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, gt, lt } from "drizzle-orm";
import {
  db,
  driveBackupConnectionsTable,
  driveBackupOauthStatesTable,
  driveBackupSettingsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import {
  DRIVE_SCOPES,
  completeClientDriveBackup,
  encryptRefreshToken,
  ensureBackupSettings,
  getDriveBackupStatus,
  googleBackupOauthClient,
  nextBackupAt,
  prepareClientDriveBackup,
  prepareClientDriveRecovery,
  revokeDriveConnection,
  type BackupFrequency,
} from "../lib/driveBackup";

const router: IRouter = Router();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const MOBILE_RETURN_URL = "vmcelectronicerp://google-backup";
const FREQUENCIES = new Set<BackupFrequency>(["never", "daily", "weekly", "monthly"]);

function stateHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mobileRedirect(res: any, status: "connected" | "cancelled" | "error"): void {
  res.redirect(302, `${MOBILE_RETURN_URL}?status=${status}`);
}

router.get(
  "/drive-backup",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getDriveBackupStatus(req.user!.id));
  }),
);

router.get(
  "/drive-backup/oauth/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    await db
      .delete(driveBackupOauthStatesTable)
      .where(lt(driveBackupOauthStatesTable.expiresAt, new Date()));
    const state = randomBytes(32).toString("base64url");
    await db.insert(driveBackupOauthStatesTable).values({
      stateHash: stateHash(state),
      userId: req.user!.id,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });
    const url = googleBackupOauthClient().generateAuthUrl({
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: true,
      scope: [...DRIVE_SCOPES],
      state,
    });
    res.json({ url });
  }),
);

router.get(
  "/drive-backup/oauth/callback",
  asyncHandler(async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !state || req.query.error) {
      mobileRedirect(res, req.query.error === "access_denied" ? "cancelled" : "error");
      return;
    }

    const [claimed] = await db
      .delete(driveBackupOauthStatesTable)
      .where(
        and(
          eq(driveBackupOauthStatesTable.stateHash, stateHash(state)),
          gt(driveBackupOauthStatesTable.expiresAt, new Date()),
        ),
      )
      .returning({ userId: driveBackupOauthStatesTable.userId });
    if (!claimed) {
      mobileRedirect(res, "error");
      return;
    }

    try {
      const client = googleBackupOauthClient();
      const { tokens } = await client.getToken(code);
      if (!tokens.refresh_token || !tokens.id_token) throw new Error("Google did not return reusable credentials");
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env["GOOGLE_BACKUP_CLIENT_ID"],
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || payload.email_verified !== true) {
        throw new Error("A verified Google email is required");
      }
      await db
        .insert(driveBackupConnectionsTable)
        .values({
          userId: claimed.userId,
          googleSubject: payload.sub,
          email: payload.email,
          encryptedRefreshToken: encryptRefreshToken(tokens.refresh_token),
          scopes: DRIVE_SCOPES.join(" "),
        })
        .onConflictDoUpdate({
          target: driveBackupConnectionsTable.userId,
          set: {
            googleSubject: payload.sub,
            email: payload.email,
            encryptedRefreshToken: encryptRefreshToken(tokens.refresh_token),
            scopes: DRIVE_SCOPES.join(" "),
            updatedAt: new Date(),
          },
        });
      await ensureBackupSettings(claimed.userId);
      mobileRedirect(res, "connected");
    } catch {
      mobileRedirect(res, "error");
    }
  }),
);

router.patch(
  "/drive-backup/settings",
  requireAuth,
  asyncHandler(async (req, res) => {
    const frequency = req.body?.automaticFrequency;
    const allowCellular = req.body?.allowCellular;
    const includeVideos = req.body?.includeVideos;
    if (
      !FREQUENCIES.has(frequency) ||
      typeof allowCellular !== "boolean" ||
      typeof includeVideos !== "boolean"
    ) {
      res.status(400).json({ message: "Invalid backup settings" });
      return;
    }
    const current = await ensureBackupSettings(req.user!.id);
    const effectiveFrequency = "never";
    await db
      .update(driveBackupSettingsTable)
      .set({
        automaticFrequency: effectiveFrequency,
        allowCellular,
        includeVideos,
        nextBackupAt:
          effectiveFrequency === "never"
            ? null
            : current.nextBackupAt ?? nextBackupAt(effectiveFrequency, current.lastBackupAt ?? new Date()),
        updatedAt: new Date(),
      })
      .where(eq(driveBackupSettingsTable.userId, req.user!.id));
    res.json(await getDriveBackupStatus(req.user!.id));
  }),
);

router.post(
  "/drive-backup/prepare",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      res.json(await prepareClientDriveBackup(req.user!.id));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "GOOGLE_ACCOUNT_REQUIRED") {
        res.status(409).json({ message: "Add a Google account before backing up." });
        return;
      }
      if (code === "BACKUP_DRIVE_VERSION_UNAVAILABLE") {
        res.status(409).json({
          message: "The current Drive backup version could not be locked. Please try again.",
        });
        return;
      }
      if (code === "BACKUP_UPLOAD_IN_PROGRESS") {
        res.status(409).json({
          message: "Another device is already preparing this backup. Try again shortly.",
        });
        return;
      }
      throw error;
    }
  }),
);

router.post(
  "/drive-backup/complete",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = req.body;
    if (
      typeof input?.fileId !== "string" ||
      typeof input?.sizeBytes !== "string" ||
      typeof input?.encryptionSalt !== "string" ||
      typeof input?.encryptionVerifier !== "string" ||
      typeof input?.uploadLeaseToken !== "string"
    ) {
      res.status(400).json({ message: "Invalid encrypted backup completion." });
      return;
    }
    try {
      res.json(await completeClientDriveBackup(req.user!.id, input));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "BACKUP_RECOVERY_PASSWORD_INVALID") {
        res.status(409).json({ message: "That recovery password is incorrect." });
        return;
      }
      if (code === "BACKUP_ARCHIVE_INVALID") {
        res.status(422).json({ message: "The uploaded encrypted backup is invalid." });
        return;
      }
      if (code === "BACKUP_FILE_REPLACEMENT_REQUIRED") {
        res.status(409).json({
          message: "The existing Drive backup must be replaced before encryption can be enabled.",
        });
        return;
      }
      if (code === "BACKUP_UPLOAD_LEASE_INVALID") {
        res.status(409).json({
          message: "This backup upload expired or was replaced by another device. Start again.",
        });
        return;
      }
      throw error;
    }
  }),
);

router.post(
  "/drive-backup/recovery/prepare",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      res.json(await prepareClientDriveRecovery(req.user!.id));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "BACKUP_NOT_FOUND") {
        res.status(404).json({ message: "No encrypted backup is available yet." });
        return;
      }
      if (code === "GOOGLE_ACCOUNT_REQUIRED") {
        res.status(409).json({ message: "Reconnect Google Drive to recover this backup." });
        return;
      }
      throw error;
    }
  }),
);

router.delete(
  "/drive-backup/account",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [connection] = await db
      .select()
      .from(driveBackupConnectionsTable)
      .where(eq(driveBackupConnectionsTable.userId, req.user!.id))
      .limit(1);
    if (connection) await revokeDriveConnection(connection);
    await db
      .delete(driveBackupConnectionsTable)
      .where(eq(driveBackupConnectionsTable.userId, req.user!.id));
    await db
      .update(driveBackupSettingsTable)
      .set({ backupFileId: null, nextBackupAt: null, lastError: null, updatedAt: new Date() })
      .where(eq(driveBackupSettingsTable.userId, req.user!.id));
    res.status(204).send();
  }),
);

export default router;