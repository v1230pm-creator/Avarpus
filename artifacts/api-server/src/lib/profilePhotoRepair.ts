import { and, eq, isNotNull, notLike } from "drizzle-orm";
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
