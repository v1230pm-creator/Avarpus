import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
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
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";

export const DRIVE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
] as const;

export type BackupFrequency = "never" | "daily" | "weekly" | "monthly";
export const MIN_RECOVERY_PASSWORD_LENGTH = 12;

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
  encryptionEnabled: boolean;
  lastBackupAt: string | null;
  lastBackupSizeBytes: string | null;
  nextBackupAt: string | null;
  backupDue: boolean;
  lastError: string | null;
};

export type BackupRecoverySummary = {
  createdAt: string;
  roomCount: number;
  messageCount: number;
};

export type BackupMediaSummary = {
  includedCount: number;
  includedBytes: number;
  /** Attachments whose relay copy is gone; listed in the archive, bytes omitted. */
  onDeviceOnlyCount: number;
  skippedVideoCount: number;
};

export type ClientBackupPreparation = {
  archiveBase64: string;
  accessToken: string;
  existingFileId: string | null;
  driveEtag: string | null;
  uploadLeaseToken: string;
  encryptionSalt: string | null;
  media: BackupMediaSummary;
};

export type ClientRecoveryPreparation = {
  accessToken: string;
  fileId: string;
  encryptionSalt: string;
};

async function withDriveBackupLock<T>(
  userId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"avarpus:drive-backup:" + userId}))`,
    );
    return operation();
  });
}

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

function recoveryPasswordKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  });
}

function recoveryPasswordVerifier(key: Buffer): Buffer {
  return createHmac("sha256", key).update("avarpus:drive-backup:recovery:v1").digest();
}

export function createRecoveryPasswordConfig(password: string): {
  salt: string;
  verifier: string;
} {
  const salt = randomBytes(16);
  const key = recoveryPasswordKey(password, salt);
  return {
    salt: salt.toString("base64url"),
    verifier: recoveryPasswordVerifier(key).toString("base64url"),
  };
}

export function verifyRecoveryPassword(
  password: string,
  saltEncoded: string,
  verifierEncoded: string,
): boolean {
  try {
    const key = recoveryPasswordKey(password, Buffer.from(saltEncoded, "base64url"));
    const expected = Buffer.from(verifierEncoded, "base64url");
    const actual = recoveryPasswordVerifier(key);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function encryptBackupArchive(
  archive: Buffer,
  password: string,
  saltEncoded: string,
): Buffer {
  const salt = Buffer.from(saltEncoded, "base64url");
  const key = recoveryPasswordKey(password, salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(archive), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.from(
    JSON.stringify({
      format: "avarpus-chat-backup-encrypted",
      version: 1,
      kdf: "scrypt",
      cipher: "aes-256-gcm",
      salt: saltEncoded,
      iv: iv.toString("base64url"),
      authTag: tag.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    }),
    "utf8",
  );
}

export function decryptBackupArchive(encryptedArchive: Buffer, password: string): Buffer {
  const envelope = JSON.parse(encryptedArchive.toString("utf8")) as {
    format?: string;
    version?: number;
    salt?: string;
    iv?: string;
    authTag?: string;
    ciphertext?: string;
  };
  if (
    envelope.format !== "avarpus-chat-backup-encrypted" ||
    envelope.version !== 1 ||
    !envelope.salt ||
    !envelope.iv ||
    !envelope.authTag ||
    !envelope.ciphertext
  ) {
    throw new Error("Encrypted backup format is invalid");
  }
  const key = recoveryPasswordKey(
    password,
    Buffer.from(envelope.salt, "base64url"),
  );
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]);
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
      encryptionEnabled: false,
      recoveryPasswordSalt: null,
      recoveryPasswordVerifier: null,
      nextBackupAt: null,
    })
    .onConflictDoNothing({ target: driveBackupSettingsTable.userId });
  const [settings] = await db
    .select()
    .from(driveBackupSettingsTable)
    .where(eq(driveBackupSettingsTable.userId, userId))
    .limit(1);
  if (!settings) throw new Error("Could not load Drive backup settings");
  if (settings.automaticFrequency !== "never" || settings.nextBackupAt !== null) {
    const [normalized] = await db
      .update(driveBackupSettingsTable)
      .set({
        automaticFrequency: "never",
        nextBackupAt: null,
        updatedAt: new Date(),
      })
      .where(eq(driveBackupSettingsTable.userId, userId))
      .returning();
    if (normalized) return normalized;
  }
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
    encryptionEnabled: settings.encryptionEnabled,
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

type BuiltArchive = { archive: Buffer; media: BackupMediaSummary };

/**
 * Build the plaintext archive. The server is only a temporary relay for chat
 * media, so an attachment is embedded only while its relay copy still exists;
 * otherwise the message is kept with `media: null` and
 * `mediaAvailability: "on_device_only"` so the archive is honest about what it
 * holds instead of failing or silently dropping the message.
 */
async function buildArchive(userId: string, includeVideos: boolean): Promise<BuiltArchive> {
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
            mediaState: chatMessagesTable.mediaState,
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
  const summary: BackupMediaSummary = {
    includedCount: 0,
    includedBytes: 0,
    onDeviceOnlyCount: 0,
    skippedVideoCount: messages.length - filteredMessages.length,
  };

  for (const message of filteredMessages) {
    const { mediaState, ...rest } = message;
    let media: Record<string, unknown> | null = null;
    let mediaAvailability: "included" | "on_device_only" | null = null;
    if (message.objectPath) {
      let file: Awaited<ReturnType<ObjectStorageService["getObjectEntityFile"]>> | null = null;
      if (mediaState === "available") {
        try {
          file = await objectStorage.getObjectEntityFile(message.objectPath);
        } catch (error) {
          if (!(error instanceof ObjectNotFoundError)) throw error;
          file = null;
        }
      }
      if (file) {
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
        mediaAvailability = "included";
        summary.includedCount += 1;
        summary.includedBytes += bytes.byteLength;
      } else {
        mediaAvailability = "on_device_only";
        summary.onDeviceOnlyCount += 1;
      }
    }
    const roomMessages = messagesByRoom.get(message.roomId) ?? [];
    roomMessages.push({ ...rest, media, mediaAvailability });
    messagesByRoom.set(message.roomId, roomMessages);
  }

  const archive = Buffer.from(
    JSON.stringify({
      format: "avarpus-chat-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      media: summary,
      rooms: memberships.map((room) => ({
        ...room,
        messages: messagesByRoom.get(room.roomId) ?? [],
      })),
    }),
    "utf8",
  );
  return { archive, media: summary };
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
  encrypted: boolean,
): Promise<{ id: string; size?: string; modifiedTime?: string }> {
  const metadata = {
    name: encrypted ? "Avarpus Chat Backup.avb" : "Avarpus Chat Backup.json",
    mimeType: encrypted ? "application/octet-stream" : "application/json",
    appProperties: {
      source: "avarpus-chat-backup",
      version: encrypted ? "2" : "1",
      encrypted: String(encrypted),
    },
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
      return uploadArchive(connection, null, archive, encrypted);
    }
    throw error;
  }
}

async function downloadArchive(
  connection: DbDriveBackupConnection,
  fileId: string,
): Promise<Buffer> {
  const response = await connectedClient(connection).request<ArrayBuffer>({
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    method: "GET",
    responseType: "arraybuffer",
  });
  return Buffer.from(response.data);
}

async function driveAccessToken(connection: DbDriveBackupConnection): Promise<string> {
  const result = await connectedClient(connection).getAccessToken();
  if (!result.token) throw new Error("GOOGLE_ACCOUNT_REQUIRED");
  return result.token;
}

function parseClientEncryptedEnvelope(archive: Buffer): {
  salt: string;
  ciphertext: string;
} {
  const envelope = JSON.parse(archive.toString("utf8")) as Record<string, unknown>;
  const allowed = new Set([
    "format",
    "version",
    "kdf",
    "iterations",
    "cipher",
    "salt",
    "iv",
    "ciphertext",
  ]);
  const decodeCanonicalBase64 = (
    value: unknown,
    expectedLength?: number,
  ): Buffer | null => {
    if (typeof value !== "string" || value.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      return null;
    }
    const decoded = Buffer.from(value, "base64");
    if (decoded.toString("base64") !== value) return null;
    if (expectedLength !== undefined && decoded.byteLength !== expectedLength) return null;
    return decoded;
  };
  const salt = decodeCanonicalBase64(envelope.salt, 16);
  const iv = decodeCanonicalBase64(envelope.iv, 12);
  const ciphertext = decodeCanonicalBase64(envelope.ciphertext);
  if (
    envelope.format !== "avarpus-chat-backup-encrypted" ||
    envelope.version !== 2 ||
    envelope.kdf !== "pbkdf2-sha256" ||
    envelope.cipher !== "aes-256-gcm" ||
    typeof envelope.iterations !== "number" ||
    envelope.iterations < 200_000 ||
    !salt ||
    !iv ||
    !ciphertext ||
    ciphertext.byteLength < 17 ||
    ciphertext.byteLength > 50 * 1024 * 1024 + 16 ||
    Object.keys(envelope).some((key) => !allowed.has(key))
  ) {
    throw new Error("BACKUP_ARCHIVE_INVALID");
  }
  const visibleCiphertext = ciphertext.toString("utf8");
  if (
    visibleCiphertext.includes("avarpus-chat-backup") ||
    visibleCiphertext.includes('"messages"') ||
    visibleCiphertext.includes('"media"')
  ) {
    throw new Error("BACKUP_ARCHIVE_INVALID");
  }
  return { salt: envelope.salt as string, ciphertext: envelope.ciphertext as string };
}

export async function prepareClientDriveBackup(
  userId: string,
): Promise<ClientBackupPreparation> {
  return withDriveBackupLock(userId, async () => {
    const settings = await ensureBackupSettings(userId);
    const now = new Date();
    if (
      settings.uploadLeaseHash &&
      settings.uploadLeaseExpiresAt &&
      settings.uploadLeaseExpiresAt > now
    ) {
      throw new Error("BACKUP_UPLOAD_IN_PROGRESS");
    }
    const [connection] = await db
      .select()
      .from(driveBackupConnectionsTable)
      .where(eq(driveBackupConnectionsTable.userId, userId))
      .limit(1);
    if (!connection) throw new Error("GOOGLE_ACCOUNT_REQUIRED");
    const drive = connectedClient(connection);
    if (
      settings.backupFileId &&
      settings.uploadLeaseHash &&
      settings.uploadLeaseExpiresAt &&
      settings.uploadLeaseExpiresAt <= now
    ) {
      await drive.request({
        url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(settings.backupFileId)}`,
        method: "PATCH",
        data: {
          appProperties: {
            source: "avarpus-chat-backup",
            uploadFence: randomBytes(16).toString("base64url"),
          },
        },
      });
    }
    let driveEtag: string | null = null;
    if (settings.backupFileId) {
      const metadata = await drive.request({
        url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(settings.backupFileId)}?fields=id`,
        method: "GET",
      });
      driveEtag = metadata.headers?.get("etag") ?? null;
      if (!driveEtag) throw new Error("BACKUP_DRIVE_VERSION_UNAVAILABLE");
    }
    const { archive, media } = await buildArchive(userId, settings.includeVideos);
    if (archive.byteLength > 50 * 1024 * 1024) {
      throw new Error("Backup is larger than the 50 MB safety limit");
    }
    const uploadLeaseToken = randomBytes(32).toString("base64url");
    await db
      .update(driveBackupSettingsTable)
      .set({
        uploadLeaseHash: createHash("sha256").update(uploadLeaseToken).digest("hex"),
        uploadLeaseExpiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        updatedAt: now,
      })
      .where(eq(driveBackupSettingsTable.userId, userId));
    return {
      archiveBase64: archive.toString("base64"),
      accessToken: await driveAccessToken(connection),
      existingFileId: settings.backupFileId,
      driveEtag,
      uploadLeaseToken,
      encryptionSalt: settings.recoveryPasswordSalt,
      media,
    };
  });
}

export async function completeClientDriveBackup(
  userId: string,
  input: {
    fileId: string;
    sizeBytes: string;
    encryptionSalt: string;
    encryptionVerifier: string;
    uploadLeaseToken: string;
  },
): Promise<BackupStatus> {
  return withDriveBackupLock(userId, async () => {
    const settings = await ensureBackupSettings(userId);
    const submittedLeaseHash = createHash("sha256")
      .update(input.uploadLeaseToken)
      .digest("hex");
    if (
      !settings.uploadLeaseHash ||
      !settings.uploadLeaseExpiresAt ||
      settings.uploadLeaseExpiresAt <= new Date() ||
      !timingSafeEqual(
        Buffer.from(settings.uploadLeaseHash, "hex"),
        Buffer.from(submittedLeaseHash, "hex"),
      )
    ) {
      throw new Error("BACKUP_UPLOAD_LEASE_INVALID");
    }
    const [connection] = await db
      .select()
      .from(driveBackupConnectionsTable)
      .where(eq(driveBackupConnectionsTable.userId, userId))
      .limit(1);
    if (!connection) throw new Error("GOOGLE_ACCOUNT_REQUIRED");
    if (settings.backupFileId && settings.backupFileId !== input.fileId) {
      throw new Error("BACKUP_FILE_REPLACEMENT_REQUIRED");
    }
    const uploaded = await downloadArchive(connection, input.fileId);
    if (uploaded.byteLength > 70 * 1024 * 1024) throw new Error("BACKUP_ARCHIVE_INVALID");
    if (input.sizeBytes !== String(uploaded.byteLength)) throw new Error("BACKUP_ARCHIVE_INVALID");
    const verifierBytes = Buffer.from(input.encryptionVerifier, "base64");
    if (
      verifierBytes.byteLength !== 32 ||
      verifierBytes.toString("base64") !== input.encryptionVerifier
    ) {
      throw new Error("BACKUP_ARCHIVE_INVALID");
    }
    const envelope = parseClientEncryptedEnvelope(uploaded);
    if (envelope.salt !== input.encryptionSalt) throw new Error("BACKUP_ARCHIVE_INVALID");
    if (
      settings.encryptionEnabled &&
      (settings.recoveryPasswordSalt !== input.encryptionSalt ||
        settings.recoveryPasswordVerifier !== input.encryptionVerifier)
    ) {
      throw new Error("BACKUP_RECOVERY_PASSWORD_INVALID");
    }
    const now = new Date();
    await db
      .update(driveBackupSettingsTable)
      .set({
        encryptionEnabled: true,
        recoveryPasswordSalt: input.encryptionSalt,
        recoveryPasswordVerifier: input.encryptionVerifier,
        backupFileId: input.fileId,
        lastBackupAt: now,
        lastBackupSizeBytes: input.sizeBytes,
        lastError: null,
        automaticFrequency: "never",
        nextBackupAt: null,
        uploadLeaseHash: null,
        uploadLeaseExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(driveBackupSettingsTable.userId, userId));
    return getDriveBackupStatus(userId);
  });
}

export async function prepareClientDriveRecovery(
  userId: string,
): Promise<ClientRecoveryPreparation> {
  const settings = await ensureBackupSettings(userId);
  if (
    !settings.encryptionEnabled ||
    !settings.backupFileId ||
    !settings.recoveryPasswordSalt
  ) {
    throw new Error("BACKUP_NOT_FOUND");
  }
  const [connection] = await db
    .select()
    .from(driveBackupConnectionsTable)
    .where(eq(driveBackupConnectionsTable.userId, userId))
    .limit(1);
  if (!connection) throw new Error("GOOGLE_ACCOUNT_REQUIRED");
  return {
    accessToken: await driveAccessToken(connection),
    fileId: settings.backupFileId,
    encryptionSalt: settings.recoveryPasswordSalt,
  };
}

export async function recoverDriveBackup(
  userId: string,
  recoveryPassword: string,
): Promise<BackupRecoverySummary> {
  const settings = await ensureBackupSettings(userId);
  if (
    !settings.encryptionEnabled ||
    !settings.recoveryPasswordSalt ||
    !settings.recoveryPasswordVerifier
  ) {
    throw new Error("BACKUP_ENCRYPTION_REQUIRED");
  }
  if (
    !verifyRecoveryPassword(
      recoveryPassword,
      settings.recoveryPasswordSalt,
      settings.recoveryPasswordVerifier,
    )
  ) {
    throw new Error("BACKUP_RECOVERY_PASSWORD_INVALID");
  }
  if (!settings.backupFileId) throw new Error("BACKUP_NOT_FOUND");

  const [connection] = await db
    .select()
    .from(driveBackupConnectionsTable)
    .where(eq(driveBackupConnectionsTable.userId, userId))
    .limit(1);
  if (!connection) throw new Error("GOOGLE_ACCOUNT_REQUIRED");

  const encryptedArchive = await downloadArchive(connection, settings.backupFileId);
  const archive = JSON.parse(
    decryptBackupArchive(encryptedArchive, recoveryPassword).toString("utf8"),
  ) as {
    format?: string;
    createdAt?: string;
    rooms?: Array<{ messages?: unknown[] }>;
  };
  if (
    archive.format !== "avarpus-chat-backup" ||
    typeof archive.createdAt !== "string" ||
    !Array.isArray(archive.rooms)
  ) {
    throw new Error("BACKUP_ARCHIVE_INVALID");
  }
  return {
    createdAt: archive.createdAt,
    roomCount: archive.rooms.length,
    messageCount: archive.rooms.reduce(
      (total, room) => total + (Array.isArray(room.messages) ? room.messages.length : 0),
      0,
    ),
  };
}

async function runDriveBackupUnlocked(
  userId: string,
  recoveryPassword?: string,
): Promise<BackupStatus> {
  const settings = await ensureBackupSettings(userId);
  const [connection] = await db
    .select()
    .from(driveBackupConnectionsTable)
    .where(eq(driveBackupConnectionsTable.userId, userId))
    .limit(1);
  if (!connection) throw new Error("GOOGLE_ACCOUNT_REQUIRED");

  try {
    if (settings.encryptionEnabled) {
      if (
        !recoveryPassword ||
        !settings.recoveryPasswordSalt ||
        !settings.recoveryPasswordVerifier
      ) {
        throw new Error("BACKUP_RECOVERY_PASSWORD_REQUIRED");
      }
      if (
        !verifyRecoveryPassword(
          recoveryPassword,
          settings.recoveryPasswordSalt,
          settings.recoveryPasswordVerifier,
        )
      ) {
        throw new Error("BACKUP_RECOVERY_PASSWORD_INVALID");
      }
    }
    let { archive } = await buildArchive(userId, settings.includeVideos);
    if (settings.encryptionEnabled) {
      archive = encryptBackupArchive(
        archive,
        recoveryPassword!,
        settings.recoveryPasswordSalt!,
      );
    }
    if (archive.byteLength > 50 * 1024 * 1024) {
      throw new Error("Backup is larger than the 50 MB safety limit");
    }
    const uploaded = await uploadArchive(
      connection,
      settings.backupFileId,
      archive,
      settings.encryptionEnabled,
    );
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

export async function runDriveBackup(
  userId: string,
  recoveryPassword?: string,
): Promise<BackupStatus> {
  return withDriveBackupLock(userId, () =>
    runDriveBackupUnlocked(userId, recoveryPassword),
  );
}

export async function setupDriveBackupEncryption(
  userId: string,
  recoveryPassword: string,
): Promise<BackupStatus> {
  return withDriveBackupLock(userId, async () => {
    const current = await ensureBackupSettings(userId);
    if (current.encryptionEnabled) {
      throw new Error("BACKUP_ENCRYPTION_ALREADY_ENABLED");
    }
    const config = createRecoveryPasswordConfig(recoveryPassword);
    await db
      .update(driveBackupSettingsTable)
      .set({
        encryptionEnabled: true,
        recoveryPasswordSalt: config.salt,
        recoveryPasswordVerifier: config.verifier,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(driveBackupSettingsTable.userId, userId));

    if (!current.backupFileId) return getDriveBackupStatus(userId);

    try {
      return await runDriveBackupUnlocked(userId, recoveryPassword);
    } catch (error) {
      await db
        .update(driveBackupSettingsTable)
        .set({
          encryptionEnabled: current.encryptionEnabled,
          recoveryPasswordSalt: current.recoveryPasswordSalt,
          recoveryPasswordVerifier: current.recoveryPasswordVerifier,
          backupFileId: current.backupFileId,
          lastBackupAt: current.lastBackupAt,
          lastBackupSizeBytes: current.lastBackupSizeBytes,
          lastError: current.lastError,
          nextBackupAt: current.nextBackupAt,
          updatedAt: new Date(),
        })
        .where(eq(driveBackupSettingsTable.userId, userId));
      throw error;
    }
  });
}

export async function revokeDriveConnection(connection: DbDriveBackupConnection): Promise<void> {
  try {
    await connectedClient(connection).revokeCredentials();
  } catch {
    // Local disconnect must still complete when Google is temporarily unavailable.
  }
}