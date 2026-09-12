import { ObjectStorageService } from "./objectStorage";

// Single source of truth for what an upload may be. The upload-URL endpoints
// check the *claimed* name/size/type, but a signed PUT URL cannot enforce
// either, so anything that attaches an object to a record must re-check the
// stored object against the same limits (`verifyStoredUpload`).

export const MAX_GENERAL_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_PROFILE_UPLOAD_BYTES = 5 * 1024 * 1024;

export const GENERAL_UPLOAD_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf",
]);
export const PROFILE_UPLOAD_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg", "image/png", "image/webp",
]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** True when the leading bytes are plausible for the declared content type. */
export function bytesMatchContentType(head: Buffer, contentType: string): boolean {
  switch (contentType) {
    case "image/jpeg":
      return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/png":
      return head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE);
    case "image/webp":
      return head.length >= 12
        && head.subarray(0, 4).toString("ascii") === "RIFF"
        && head.subarray(8, 12).toString("ascii") === "WEBP";
    case "image/heic":
    case "image/heif":
      // ISO BMFF: size(4) + "ftyp"(4) + major brand(4)
      return head.length >= 12 && head.subarray(4, 8).toString("ascii") === "ftyp";
    case "application/pdf":
      return head.length >= 5 && head.subarray(0, 5).toString("latin1") === "%PDF-";
    default:
      return false;
  }
}

export type StoredUploadCheck =
  | { ok: true; size: number; contentType: string }
  | { ok: false; message: string };

/**
 * Confirms a stored object honours the policy it was issued under: it exists,
 * its size is within the cap, its stored content type is allowed, and its
 * leading bytes match that type. Objects that fail are deleted so an abusive
 * upload cannot sit in the bucket waiting for a later attach attempt.
 */
export async function verifyStoredUpload(
  storage: ObjectStorageService,
  objectPath: string,
  policy: { maxBytes: number; contentTypes: ReadonlySet<string>; label: string },
): Promise<StoredUploadCheck> {
  let file;
  try {
    file = await storage.getObjectEntityFile(objectPath);
  } catch {
    return { ok: false, message: `${policy.label} was not uploaded` };
  }
  const reject = async (message: string): Promise<StoredUploadCheck> => {
    await file.delete({ ignoreNotFound: true }).catch(() => undefined);
    return { ok: false, message };
  };
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);
  const contentType = String(metadata.contentType ?? "").toLowerCase().split(";")[0].trim();
  if (!Number.isFinite(size) || size <= 0 || size > policy.maxBytes) {
    return reject(`${policy.label} must be between 1 byte and ${Math.floor(policy.maxBytes / (1024 * 1024))} MB`);
  }
  if (!policy.contentTypes.has(contentType)) {
    return reject(`${policy.label} has an unsupported file type`);
  }
  const [head] = await file.download({ start: 0, end: 63 });
  if (!bytesMatchContentType(head, contentType)) {
    return reject(`${policy.label} contents do not match the declared file type`);
  }
  return { ok: true, size, contentType };
}
