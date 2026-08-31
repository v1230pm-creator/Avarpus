import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  chatMessagesTable,
  db,
  pendingUploadsTable,
  shopsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";

export type PendingUploadPurpose = "chat" | "profile";

// A normal upload URL expires after 15 minutes. Forty-eight hours gives mobile
// retries and interrupted composers ample time before an object is reclaimed.
export const ABANDONED_UPLOAD_GRACE_MS = 48 * 60 * 60 * 1000;
export const UPLOAD_PROCESSING_LEASE_MS = 30 * 60 * 1000;
export const CHAT_PROVIDER_SEND_TIMEOUT_MS = 30 * 1000;

const PROFILE_OBJECT_RE =
  /^\/objects\/uploads\/profiles\/[0-9a-f-]{36}\/(?:final\/)?[0-9a-f-]{36}$/i;
const CHAT_OBJECT_RE =
  /^\/objects\/uploads\/(?:global|[0-9a-f-]{36})\/chat\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i;

const objectStorageService = new ObjectStorageService();

function purposeForPath(objectPath: string): PendingUploadPurpose | null {
  if (PROFILE_OBJECT_RE.test(objectPath)) return "profile";
  if (CHAT_OBJECT_RE.test(objectPath)) return "chat";
  return null;
}

async function lockObjectPath(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  objectPath: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${objectPath}, 0))
  `);
}

export async function registerPendingUpload(input: {
  objectPath: string;
  ownerUserId: string;
  purpose: PendingUploadPurpose;
}): Promise<void> {
  const inserted = await db
    .insert(pendingUploadsTable)
    .values(input)
    .onConflictDoNothing({ target: pendingUploadsTable.objectPath })
    .returning({ objectPath: pendingUploadsTable.objectPath });
  if (inserted.length) return;

  const [existing] = await db
    .select({
      ownerUserId: pendingUploadsTable.ownerUserId,
      purpose: pendingUploadsTable.purpose,
    })
    .from(pendingUploadsTable)
    .where(eq(pendingUploadsTable.objectPath, input.objectPath))
    .limit(1);
  if (
    !existing ||
    existing.ownerUserId !== input.ownerUserId ||
    existing.purpose !== input.purpose
  ) {
    throw new Error("Upload ownership could not be registered");
  }
}

/**
 * Mark an upload as actively being attached. Cleanup takes the same advisory
 * lock, so either cleanup finishes first (and the caller's storage validation
 * fails closed) or the lease is visible before cleanup can delete anything.
 */
export async function claimPendingUpload(input: {
  objectPath: string;
  ownerUserId: string;
  purpose: PendingUploadPurpose;
  now?: Date;
}): Promise<{ token: string; claimUntil: Date } | null> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await lockObjectPath(tx, input.objectPath);
    const [existing] = await tx
      .select()
      .from(pendingUploadsTable)
      .where(eq(pendingUploadsTable.objectPath, input.objectPath))
      .limit(1);
    if (
      !existing ||
      existing.ownerUserId !== input.ownerUserId ||
      existing.purpose !== input.purpose ||
      (existing.claimUntil !== null && existing.claimUntil > now)
    ) {
      return null;
    }
    const token = randomUUID();
    const claimUntil = new Date(now.getTime() + UPLOAD_PROCESSING_LEASE_MS);
    await tx
      .update(pendingUploadsTable)
      .set({ claimToken: token, claimUntil })
      .where(eq(pendingUploadsTable.objectPath, input.objectPath));
    return { token, claimUntil };
  });
}

export async function releasePendingUpload(input: {
  objectPath: string;
  ownerUserId: string;
  purpose: PendingUploadPurpose;
  token: string;
}): Promise<void> {
  await db
    .update(pendingUploadsTable)
    .set({ claimToken: null, claimUntil: null })
    .where(and(
      eq(pendingUploadsTable.objectPath, input.objectPath),
      eq(pendingUploadsTable.ownerUserId, input.ownerUserId),
      eq(pendingUploadsTable.purpose, input.purpose),
      eq(pendingUploadsTable.claimToken, input.token),
    ));
}

export async function completePendingUpload(input: {
  objectPath: string;
  ownerUserId: string;
  purpose: PendingUploadPurpose;
  token: string;
}): Promise<void> {
  await db
    .delete(pendingUploadsTable)
    .where(and(
      eq(pendingUploadsTable.objectPath, input.objectPath),
      eq(pendingUploadsTable.ownerUserId, input.ownerUserId),
      eq(pendingUploadsTable.purpose, input.purpose),
      eq(pendingUploadsTable.claimToken, input.token),
    ));
}

export async function refreshPendingUploadClaim(input: {
  objectPath: string;
  ownerUserId: string;
  purpose: PendingUploadPurpose;
  token: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await lockObjectPath(tx, input.objectPath);
    const claimUntil = new Date(now.getTime() + UPLOAD_PROCESSING_LEASE_MS);
    const renewed = await tx
      .update(pendingUploadsTable)
      .set({ claimUntil })
      .where(and(
        eq(pendingUploadsTable.objectPath, input.objectPath),
        eq(pendingUploadsTable.ownerUserId, input.ownerUserId),
        eq(pendingUploadsTable.purpose, input.purpose),
        eq(pendingUploadsTable.claimToken, input.token),
      ))
      .returning({ objectPath: pendingUploadsTable.objectPath });
    return renewed.length === 1;
  });
}

export type PendingUploadCleanupResult = {
  listed: number;
  considered: number;
  deleted: number;
  retained: number;
  tooNew: number;
  ignored: number;
  failed: number;
};

/**
 * Delete only old, unreferenced objects in the exact Chat and Profile upload
 * shapes. Failed deletes remain in storage and are retried by the next run.
 */
export async function cleanupAbandonedChatAndProfileUploads(
  now = new Date(),
): Promise<PendingUploadCleanupResult> {
  const result: PendingUploadCleanupResult = {
    listed: 0,
    considered: 0,
    deleted: 0,
    retained: 0,
    tooNew: 0,
    ignored: 0,
    failed: 0,
  };
  const prefixes = new Set<string>([
    "uploads/profiles/",
    "uploads/global/chat/",
  ]);
  const [shops, pendingChatUploads] = await Promise.all([
    db.select({ id: shopsTable.id }).from(shopsTable),
    db.select({ objectPath: pendingUploadsTable.objectPath })
      .from(pendingUploadsTable)
      .where(eq(pendingUploadsTable.purpose, "chat")),
  ]);
  for (const shop of shops) prefixes.add(`uploads/${shop.id}/chat/`);
  for (const pending of pendingChatUploads) {
    const match = pending.objectPath.match(
      /^\/objects\/uploads\/([0-9a-f-]{36})\/chat\//i,
    );
    if (match) prefixes.add(`uploads/${match[1]}/chat/`);
  }

  const objectsByPath = new Map<string, Awaited<
    ReturnType<typeof objectStorageService.listObjectEntityFiles>
  >[number]>();
  for (const prefix of prefixes) {
    try {
      const listed = await objectStorageService.listObjectEntityFiles(prefix);
      for (const item of listed) objectsByPath.set(item.objectPath, item);
    } catch (error) {
      result.failed += 1;
      logger.warn({ err: error }, "Chat/Profile upload cleanup namespace listing failed");
    }
  }
  const objects = [...objectsByPath.values()];
  result.listed = objects.length;
  const cutoff = now.getTime() - ABANDONED_UPLOAD_GRACE_MS;

  for (const { file, objectPath } of objects) {
    const purpose = purposeForPath(objectPath);
    if (!purpose) {
      result.ignored += 1;
      continue;
    }
    result.considered += 1;
    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch (error) {
      result.failed += 1;
      logger.warn({ err: error }, "Chat/Profile upload cleanup metadata lookup failed");
      continue;
    }
    const createdAt = Date.parse(String(metadata.timeCreated ?? ""));
    if (!Number.isFinite(createdAt) || createdAt >= cutoff) {
      result.tooNew += 1;
      continue;
    }

    try {
      await db.transaction(async (tx) => {
        await lockObjectPath(tx, objectPath);
        const [activeClaim] = await tx
          .select({ objectPath: pendingUploadsTable.objectPath })
          .from(pendingUploadsTable)
          .where(and(
            eq(pendingUploadsTable.objectPath, objectPath),
            gt(pendingUploadsTable.claimUntil, now),
          ))
          .limit(1);
        if (activeClaim) {
          result.retained += 1;
          return;
        }

        const [attached] = purpose === "profile"
          ? await tx
              .select({ id: usersTable.id })
              .from(usersTable)
              .where(eq(usersTable.profilePhoto, objectPath))
              .limit(1)
          : await tx
              .select({ id: chatMessagesTable.id })
              .from(chatMessagesTable)
              .where(eq(chatMessagesTable.objectPath, objectPath))
              .limit(1);
        if (attached) {
          result.retained += 1;
          await tx
            .delete(pendingUploadsTable)
            .where(eq(pendingUploadsTable.objectPath, objectPath));
          return;
        }

        await file.delete({ ignoreNotFound: true });
        await tx
          .delete(pendingUploadsTable)
          .where(eq(pendingUploadsTable.objectPath, objectPath));
        result.deleted += 1;
      });
    } catch (error) {
      result.failed += 1;
      logger.warn({ err: error }, "Chat/Profile upload cleanup will be retried");
    }
  }

  logger.info({ result }, "Chat/Profile upload cleanup completed");
  return result;
}