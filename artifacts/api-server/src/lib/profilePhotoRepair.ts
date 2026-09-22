import { and, eq, isNotNull, like, notLike } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";

const objectStorageService = new ObjectStorageService();

const PROFILE_ENTITY_PATH_RE =
  /^\/objects\/uploads\/profiles\/[0-9a-f-]{36}\/(?:final\/)?[0-9a-f-]{36}$/i;

export interface ProfilePhotoRepairResult {
  scanned: number;
  repaired: number;
  cleared: number;
  /** Rows left untouched: unrecognised shape, or changed concurrently. */
  skipped: number;
  /** Rows whose repair hit a storage/database error; still legacy in the DB. */
  failed: number;
}

/**
 * True when no legacy row was left in a state the abandoned-upload sweep
 * could misread as "unattached": everything recognised was rewritten or
 * cleared, and nothing errored.
 */
export function repairLeftNoLegacyReferences(result: ProfilePhotoRepairResult): boolean {
  return result.failed === 0 && result.skipped === 0;
}

/**
 * Translate a legacy stored value such as
 * `/<bucket>/.private%2Fuploads%2Fprofiles%2F<user>%2Ffinal%2F<id>` back into
 * the canonical `/objects/uploads/profiles/<user>/final/<id>` entity path.
 * Returns null when the value is not a recognisable profile object under the
 * private directory.
 */
export function canonicalProfilePathFromLegacy(
  stored: string,
  privateObjectDir: string,
): string | null {
  if (stored.startsWith("/objects/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(stored);
  } catch {
    return null;
  }
  const dir = privateObjectDir.endsWith("/") ? privateObjectDir : `${privateObjectDir}/`;
  if (!decoded.startsWith(dir)) return null;
  const candidate = `/objects/${decoded.slice(dir.length)}`;
  return PROFILE_ENTITY_PATH_RE.test(candidate) ? candidate : null;
}

/**
 * Profile photos finalised before the entity-path fix were persisted as raw,
 * percent-encoded bucket paths that neither the clients nor the storage route
 * can resolve. Rewrite each such row to its canonical `/objects/…` path when
 * the object still exists; when it is gone (the abandoned-upload sweep could
 * not see it as attached), clear the reference so the account falls back to
 * initials and can upload again. Idempotent and safe to run on every boot.
 */
export async function repairLegacyProfilePhotoPaths(): Promise<ProfilePhotoRepairResult> {
  const result: ProfilePhotoRepairResult = {
    scanned: 0,
    repaired: 0,
    cleared: 0,
    skipped: 0,
    failed: 0,
  };
  const rows = await db
    .select({ id: usersTable.id, profilePhoto: usersTable.profilePhoto })
    .from(usersTable)
    .where(and(isNotNull(usersTable.profilePhoto), notLike(usersTable.profilePhoto, "/objects/%")));
  result.scanned = rows.length;
  if (rows.length === 0) return result;

  const privateObjectDir = objectStorageService.getPrivateObjectDir();
  for (const row of rows) {
    const stored = row.profilePhoto;
    if (!stored) continue;
    const canonical = canonicalProfilePathFromLegacy(stored, privateObjectDir);
    if (!canonical) {
      result.skipped += 1;
      logger.warn({ userId: row.id }, "Unrecognised legacy profile photo path left untouched");
      continue;
    }
    try {
      // Only a definitive not-found may clear the reference. Any other storage
      // failure (network, credentials, sidecar) leaves the row untouched and is
      // reported so the boot-time sweep stays disabled for this run.
      let exists = true;
      try {
        await objectStorageService.getObjectEntityFile(canonical);
      } catch (error) {
        if (!(error instanceof ObjectNotFoundError)) throw error;
        exists = false;
      }
      // Conditional on the stored value so a concurrent user update is never
      // overwritten.
      const updated = await db
        .update(usersTable)
        .set({ profilePhoto: exists ? canonical : null })
        .where(and(eq(usersTable.id, row.id), eq(usersTable.profilePhoto, stored)))
        .returning({ id: usersTable.id });
      if (updated.length === 0) {
        result.skipped += 1;
        continue;
      }
      if (exists) result.repaired += 1;
      else result.cleared += 1;
    } catch (error) {
      result.failed += 1;
      logger.warn({ err: error, userId: row.id }, "Legacy profile photo repair failed for user");
    }
  }
  logger.info({ result }, "Legacy profile photo path repair completed");
  return result;
}

export interface MissingProfilePhotoResult {
  scanned: number;
  /** Rows whose final object is definitively gone; reference cleared. */
  cleared: number;
  /** Rows changed concurrently, or whose storage check errored; left as is. */
  skipped: number;
  failed: number;
}

/**
 * A canonical row whose object no longer exists in storage (a photo lost to
 * an earlier cross-environment sweep, or removed out of band) makes every
 * client request 404 and shows the account as "has a photo" when nothing can
 * render. Clear such references so the account cleanly falls back to
 * initials and can upload again. Only `ObjectNotFoundError` may clear a row:
 * any other storage failure leaves it untouched. Never deletes an object.
 */
export async function clearMissingProfilePhotoReferences(): Promise<MissingProfilePhotoResult> {
  const result: MissingProfilePhotoResult = { scanned: 0, cleared: 0, skipped: 0, failed: 0 };
  const rows = await db
    .select({ id: usersTable.id, profilePhoto: usersTable.profilePhoto })
    .from(usersTable)
    .where(and(isNotNull(usersTable.profilePhoto), like(usersTable.profilePhoto, "/objects/uploads/profiles/%")));
  result.scanned = rows.length;
  if (rows.length === 0) return result;

  for (const row of rows) {
    const stored = row.profilePhoto;
    if (!stored) continue;
    try {
      try {
        await objectStorageService.getObjectEntityFile(stored);
        continue;
      } catch (error) {
        if (!(error instanceof ObjectNotFoundError)) throw error;
      }
      const updated = await db
        .update(usersTable)
        .set({ profilePhoto: null })
        .where(and(eq(usersTable.id, row.id), eq(usersTable.profilePhoto, stored)))
        .returning({ id: usersTable.id });
      if (updated.length === 0) {
        result.skipped += 1;
        continue;
      }
      result.cleared += 1;
      logger.warn({ userId: row.id, objectPath: stored }, "Profile photo object missing from storage; reference cleared");
    } catch (error) {
      result.failed += 1;
      logger.warn({ err: error, userId: row.id }, "Profile photo existence check failed for user");
    }
  }
  logger.info({ result }, "Missing profile photo reference check completed");
  return result;
}
