import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import {
  chatMessagesTable,
  chatRoomMembersTable,
  chatRoomsTable,
  db,
  driveBackupConnectionsTable,
  driveBackupSettingsTable,
  type DbDriveBackupConnection,
  type DbDriveBackupSettings,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage";

export const DRIVE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
] as const;

export type BackupFrequency = "never" | "daily" | "weekly" | "monthly";

type DriveQuota = {
  limitBytes: string | null;
  usageBytes: string | null;
};

type BackupStatus = {
  connected: boolean;
  email: string | null;
  quota: DriveQuota | null;
  automaticFrequency: BackupFrequency;
  allowCellular: boolean;
  includeVideos: boolean;
  lastBackupAt: string | null;
  lastBackupSizeBytes: string | null;
  nextBackupAt: string | null;
  backupDue: boolean;
  lastError: string | null;
};

function oauthConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env["GOOGLE_BACKUP_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_BACKUP_CLIENT_SECRET"];
  const redirectUri = process.env["GOOGLE_BACKUP_REDIRECT_URI"];
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google backup OAuth is not configured");
  }
  return { clientId, clientSecret, redirectUri };
}

export function googleBackupOauthClient(): OAuth2Client {
  const { clientId, clientSecret, redirectUri } = oauthConfig();
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

function tokenKey(): Buffer {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET is required for Drive token encryption");
  return createHash("sha256").update(`avarpus:drive-backup:v1:${secret}`).digest();
}

export function encryptRefreshToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptRefreshToken(payload: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = payload.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Stored Google credential is invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function connectedClient(connection: DbDriveBackupConnection): OAuth2Client {
  const client = googleBackupOauthClient();
  client.setCredentials({ refresh_token: decryptRefreshToken(connection.encryptedRefreshToken) });
  return client;
}

export function nextBackupAt(frequency: BackupFrequency, from = new Date()): Date | null {
  const next = new Date(from);
  if (frequency === "never") return null;
  if (frequency === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export async function ensureBackupSettings(userId: string): Promise<DbDriveBackupSettings> {
  await db
    .insert(driveBackupSettingsTable)
    .values({
      userId,
      automaticFrequency: "never",
      allowCellular: false,
      includeVideos: false,
      nextBackupAt: null,
    })
    .onConflictDoNothing({ target: driveBackupSettingsTable.userId });
  const [settings] = await db
    .select()
    .from(driveBackupSettingsTable)
    .where(eq(driveBackupSettingsTable.userId, userId))
    .limit(1);
  if (!settings) throw new Error("Could not load Drive backup settings");
  return settings;
}

async function driveQuota(connection: DbDriveBackupConnection): Promise<DriveQuota> {
  const response = await connectedClient(connection).request<{
    storageQuota?: { limit?: string; usage?: string };
  }>({
    url: "https://www.googleapis.com/drive/v3/about?fields=storageQuota",
    method: "GET",
  });
  return {
    limitBytes: response.data.storageQuota?.limit ?? null,
    usageBytes: response.data.storageQuota?.usage ?? null,
  };
}

export async function getDriveBackupStatus(userId: string): Promise<BackupStatus> {
  const settings = await ensureBackupSettings(userId);
  const [connection] = await db
    .select()
    .from(driveBackupConnectionsTable)
    .where(eq(driveBackupConnectionsTable.userId, userId))
    .limit(1);

  let quota: DriveQuota | null = null;
  let quotaError: string | null = null;
  if (connection) {
    try {
      quota = await driveQuota(connection);
    } catch {
      quotaError = "Google storage information is temporarily unavailable.";
    }
  }

  return {
    connected: Boolean(connection),
    email: connection?.email ?? null,
    quota,
    automaticFrequency: settings.automaticFrequency as BackupFrequency,
    allowCellular: settings.allowCellular,
    includeVideos: settings.includeVideos,
    lastBackupAt: settings.lastBackupAt?.toISOString() ?? null,
    lastBackupSizeBytes: settings.lastBackupSizeBytes,
    nextBackupAt: settings.nextBackupAt?.toISOString() ?? null,
    backupDue: Boolean(
      connection &&
        settings.automaticFrequency !== "never" &&
        settings.nextBackupAt &&
        settings.nextBackupAt.getTime() <= Date.now(),
    ),
    lastError: settings.lastError ?? quotaError,
  };
}

async function buildArchive(userId: string, includeVideos: boolean): Promise<Buffer> {
  const memberships = await db
    .select({
      roomId: chatRoomMembersTable.roomId,
      joinedAt: chatRoomMembersTable.joinedAt,
      name: chatRoomsTable.name,
      kind: chatRoomsTable.kind,
      scope: chatRoomsTable.scope,
      createdAt: chatRoomsTable.createdAt,
    })
    .from(chatRoomMembersTable)
    .innerJoin(chatRoomsTable, eq(chatRoomsTable.id, chatRoomMembersTable.roomId))
    .where(eq(chatRoomMembersTable.userId, userId))
    .orderBy(asc(chatRoomsTable.createdAt));

  const roomIds = memberships.map((membership) => membership.roomId);
  const messages =
    roomIds.length === 0
      ? []
      : await db
          .select({
            id: chatMessagesTable.id,
            roomId: chatMessagesTable.roomId,
            senderId: chatMessagesTable.senderId,
            senderName: chatMessagesTable.senderName,
            kind: chatMessagesTable.kind,
            body: chatMessagesTable.body,
            objectPath: chatMessagesTable.objectPath,
            durationMs: chatMessagesTable.durationMs,
            clientRequestId: chatMessagesTable.clientRequestId,
            createdAt: chatMessagesTable.createdAt,
          })
          .from(chatMessagesTable)
          .where(
            and(
              inArray(chatMessagesTable.roomId, roomIds),
              isNull(chatMessagesTable.deletedAt),
            ),
          )
          .orderBy(asc(chatMessagesTable.createdAt))
          .limit(100_000);

  const filteredMessages = includeVideos
    ? messages
    : messages.filter((message) => message.kind !== "video");
  const objectStorage = new ObjectStorageService();
  let embeddedMediaBytes = 0;
  const messagesByRoom = new Map<string, Array<Record<string, unknown>>>();

  for (const message of filteredMessages) {
    let media: Record<string, unknown> | null = null;
    if (message.objectPath) {
      const file = await objectStorage.getObjectEntityFile(message.objectPath);
      const [metadata] = await file.getMetadata();
      const declaredSize = Number(metadata.size ?? 0);
      if (
        !Number.isFinite(declaredSize) ||
        declaredSize < 0 ||
        embeddedMediaBytes + declaredSize > 35 * 1024 * 1024
      ) {
        throw new Error("Backup media exceeds the 50 MB safety limit");
      }
      const [bytes] = await file.download();
      embeddedMediaBytes += bytes.byteLength;
      if (embeddedMediaBytes > 35 * 1024 * 1024) {
        throw new Error("Backup media exceeds the 50 MB safety limit");
      }
      media = {
        contentType: metadata.contentType ?? "application/octet-stream",
        sizeBytes: String(bytes.byteLength),
        encoding: "base64",
        data: bytes.toString("base64"),
      };
    }
    const roomMessages = messagesByRoom.get(message.roomId) ?? [];
    roomMessages.push({ ...message, media });
    messagesByRoom.set(message.roomId, roomMessages);
  }

  return Buffer.from(
    JSON.stringify({
      format: "avarpus-chat-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      rooms: memberships.map((room) => ({
        ...room,
        messages: messagesByRoom.get(room.roomId) ?? [],
      })),
    }),
    "utf8",
  );
}

function multipartBody(metadata: object, content: Buffer): { boundary: string; body: Buffer } {
  const boundary = `avarpus-${randomBytes(12).toString("hex")}`;
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--`);
  return { boundary, body: Buffer.concat([prefix, content, suffix]) };
}

async function uploadArchive(
  connection: DbDriveBackupConnection,
  existingFileId: string | null,
  archive: Buffer,
): Promise<{ id: string; size?: string; modifiedTime?: string }> {
  const metadata = {
    name: "Avarpus Chat Backup.json",
    mimeType: "application/json",
    appProperties: { source: "avarpus-chat-backup", version: "1" },
  };
  const { boundary, body } = multipartBody(metadata, archive);
  const client = connectedClient(connection);
  const base = "https://www.googleapis.com/upload/drive/v3/files";
  const url = existingFileId
    ? `${base}/${encodeURIComponent(existingFileId)}?uploadType=multipart&fields=id,size,modifiedTime`
    : `${base}?uploadType=multipart&fields=id,size,modifiedTime`;
  try {
    const response = await client.request<{ id: string; size?: string; modifiedTime?: string }>({
      url,
      method: existingFileId ? "PATCH" : "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      data: body,
    });
    return response.data;
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (existingFileId && status === 404) {
      return uploadArchive(connection, null, archive);
    }
    throw error;
  }
}

export async function runDriveBackup(userId: string): Promise<BackupStatus> {
  const settings = await ensureBackupSettings(userId);
  const [connection] = await db
    .select()
    .from(driveBackupConnectionsTable)
    .where(eq(driveBackupConnectionsTable.userId, userId))
    .limit(1);
  if (!connection) throw new Error("GOOGLE_ACCOUNT_REQUIRED");

  try {
    const archive = await buildArchive(userId, settings.includeVideos);
    if (archive.byteLength > 50 * 1024 * 1024) {
      throw new Error("Backup is larger than the 50 MB safety limit");
    }
    const uploaded = await uploadArchive(connection, settings.backupFileId, archive);
    const now = new Date();
    await db
      .update(driveBackupSettingsTable)
      .set({
        backupFileId: uploaded.id,
        lastBackupAt: now,
        lastBackupSizeBytes: uploaded.size ?? String(archive.byteLength),
        lastError: null,
        nextBackupAt: nextBackupAt(settings.automaticFrequency as BackupFrequency, now),
        updatedAt: now,
      })
      .where(eq(driveBackupSettingsTable.userId, userId));
  } catch (error) {
    await db
      .update(driveBackupSettingsTable)
      .set({
        lastError: error instanceof Error ? error.message.slice(0, 300) : "Backup failed",
        updatedAt: new Date(),
      })
      .where(eq(driveBackupSettingsTable.userId, userId));
    throw error;
  }
  return getDriveBackupStatus(userId);
}

export async function revokeDriveConnection(connection: DbDriveBackupConnection): Promise<void> {
  try {
    await connectedClient(connection).revokeCredentials();
  } catch {
    // Local disconnect must still complete when Google is temporarily unavailable.
  }
}