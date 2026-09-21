// Copy every object from the Replit object-storage bucket into a plain Google
// Cloud Storage bucket, preserving object names, content types and custom
// metadata (including the "custom:aclPolicy" entry the API relies on).
//
// Run this ON REPLIT (it reads the source through the Replit sidecar), e.g.
// from the workspace shell:
//
//   cd artifacts/api-server
//   node scripts/migrate-objects-to-gcs.mjs \
//     --dest-bucket avarpus-prod-objects \
//     --key-file /tmp/gcs-service-account.json \
//     [--source-bucket <bucket>]   # default: bucket from PRIVATE_OBJECT_DIR
//     [--prefix .private/uploads/] # copy only this key prefix
//     [--dry-run]
//
// Idempotent: objects already present in the destination with identical bytes
// (size + md5/crc32c) are not re-copied, but their custom metadata (the ACL
// policy the API authorizes with) is still reconciled. Re-run it right before
// cutover to pick up files uploaded or re-labelled since the previous pass.
import { Storage } from "@google-cloud/storage";
import { existsSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));

const destBucketName = args["dest-bucket"];
const keyFile = args["key-file"];
if (!destBucketName || !keyFile) {
  console.error(
    "Usage: node scripts/migrate-objects-to-gcs.mjs --dest-bucket <bucket> --key-file <service-account.json> [--source-bucket <bucket>] [--prefix <key-prefix>] [--dry-run]",
  );
  process.exit(2);
}
if (!existsSync(keyFile)) {
  console.error(`Key file not found: ${keyFile}`);
  process.exit(2);
}

const sourceBucketName = args["source-bucket"] || bucketFromPrivateDir();
const prefix = args["prefix"] || "";
const dryRun = Boolean(args["dry-run"]);

const SIDECAR = "http://127.0.0.1:1106";
const source = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});
const dest = new Storage({ keyFilename: keyFile });

const sourceBucket = source.bucket(sourceBucketName);
const destBucket = dest.bucket(destBucketName);

console.log(
  `Copying gs://${sourceBucketName}/${prefix} -> gs://${destBucketName}/${prefix}${dryRun ? " (dry run)" : ""}`,
);

let copied = 0;
let skipped = 0;
let metadataUpdated = 0;
let failed = 0;
let pageToken;
do {
  const [files, nextQuery] = await sourceBucket.getFiles({
    prefix,
    autoPaginate: false,
    maxResults: 500,
    pageToken,
  });
  pageToken = nextQuery?.pageToken;

  for (const file of files) {
    try {
      const [meta] = await file.getMetadata();
      const target = destBucket.file(file.name);
      const [exists] = await target.exists();
      if (exists) {
        const [targetMeta] = await target.getMetadata();
        // Bytes are considered identical only with a positive hash match
        // (md5 or crc32c); size alone is not enough.
        const sameBytes =
          String(targetMeta.size) === String(meta.size) &&
          ((meta.md5Hash && targetMeta.md5Hash === meta.md5Hash) ||
            (meta.crc32c && targetMeta.crc32c === meta.crc32c));
        if (sameBytes) {
          // Custom metadata carries the ACL policy the API authorizes with
          // ("custom:aclPolicy"). It can change after the first pass (or be
          // attached after the bytes landed), so reconcile it even when the
          // bytes did not change.
          const wantMeta = meta.metadata ?? {};
          const haveMeta = targetMeta.metadata ?? {};
          const contentTypeDiffers =
            (meta.contentType ?? null) !== (targetMeta.contentType ?? null);
          if (!sameStringMap(wantMeta, haveMeta) || contentTypeDiffers) {
            if (!dryRun) {
              await target.setMetadata({
                contentType: meta.contentType,
                cacheControl: meta.cacheControl,
                contentDisposition: meta.contentDisposition,
                metadata: withClearedKeys(wantMeta, haveMeta),
              });
            }
            metadataUpdated++;
          } else {
            skipped++;
          }
          continue;
        }
      }
      if (dryRun) {
        console.log(`would copy ${file.name} (${meta.size} bytes)`);
        copied++;
        continue;
      }
      await new Promise((resolve, reject) => {
        file
          .createReadStream()
          .on("error", reject)
          .pipe(
            target.createWriteStream({
              resumable: Number(meta.size) > 8 * 1024 * 1024,
              metadata: {
                contentType: meta.contentType,
                cacheControl: meta.cacheControl,
                contentDisposition: meta.contentDisposition,
                metadata: meta.metadata ?? {},
              },
            }),
          )
          .on("error", reject)
          .on("finish", resolve);
      });
      copied++;
      if (copied % 50 === 0) console.log(`  ${copied} copied, ${skipped} skipped`);
    } catch (err) {
      failed++;
      console.error(`FAILED ${file.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
} while (pageToken);

console.log(
  `Done. copied=${copied} metadataUpdated=${metadataUpdated} skipped=${skipped} failed=${failed}`,
);
process.exit(failed > 0 ? 1 : 0);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function bucketFromPrivateDir() {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  const parts = dir.replace(/^\//, "").split("/");
  if (!parts[0]) {
    console.error(
      "Could not determine the source bucket: pass --source-bucket or set PRIVATE_OBJECT_DIR.",
    );
    process.exit(2);
  }
  return parts[0];
}

function sameStringMap(a, b) {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => String(a[k]) === String(b[k]));
}

// GCS drops a custom metadata key only when it is set to null explicitly.
function withClearedKeys(want, have) {
  const out = { ...want };
  for (const key of Object.keys(have)) {
    if (!(key in want)) out[key] = null;
  }
  return out;
}
