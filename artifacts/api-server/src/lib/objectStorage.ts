import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { File, Storage } from '@google-cloud/storage';

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';

/**
 * Storage backend selection.
 *
 * - `replit` (default on Replit): credentials and URL signing come from the
 *   Replit object-storage sidecar on 127.0.0.1:1106. Only works inside a
 *   Replit workspace/deployment.
 * - `gcs`: a plain Google Cloud Storage bucket authenticated with a service
 *   account key file. Used when the API runs outside Replit (e.g. a VPS).
 *   Requires `GCS_SERVICE_ACCOUNT_KEY_FILE` (path to the JSON key). URL
 *   signing is done locally with the SDK (V4 signed URLs).
 *
 * `OBJECT_STORAGE_PROVIDER` forces the choice; when unset, the presence of
 * `GCS_SERVICE_ACCOUNT_KEY_FILE` selects `gcs`, otherwise `replit`.
 */
export type ObjectStorageProvider = 'replit' | 'gcs';

export function resolveObjectStorageProvider(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorageProvider {
  const forced = (env.OBJECT_STORAGE_PROVIDER || '').trim().toLowerCase();
  if (forced === 'replit' || forced === 'gcs') return forced;
  if (forced) {
    throw new Error(
      `OBJECT_STORAGE_PROVIDER must be "replit" or "gcs" (got "${forced}")`,
    );
  }
  return env.GCS_SERVICE_ACCOUNT_KEY_FILE?.trim() ? 'gcs' : 'replit';
}

export const objectStorageProvider: ObjectStorageProvider =
  resolveObjectStorageProvider();

function createStorageClient(provider: ObjectStorageProvider): Storage {
  if (provider === 'gcs') {
    const keyFilename = process.env.GCS_SERVICE_ACCOUNT_KEY_FILE?.trim();
    if (!keyFilename) {
      throw new Error(
        'OBJECT_STORAGE_PROVIDER=gcs requires GCS_SERVICE_ACCOUNT_KEY_FILE ' +
          '(path to a Google Cloud service-account JSON key).',
      );
    }
    return new Storage({ keyFilename });
  }
  return new Storage({
    credentials: {
      audience: 'replit',
      subject_token_type: 'access_token',
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: 'external_account',
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: {
          type: 'json',
          subject_token_field_name: 'access_token',
        },
      },
      universe_domain: 'googleapis.com',
    },
    projectId: '',
  });
}

export const objectStorageClient = createStorageClient(objectStorageProvider);

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export type ListedObjectEntityFile = {
  file: File;
  objectPath: string;
};

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    const paths = Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          'tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).',
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || '';
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(
    file: File,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === 'public';

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type':
        (metadata.contentType as string) || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers['Content-Length'] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  // `scope` namespaces the object under uploads/<scope>/ so ownership can be
  // enforced from the path alone (we scope by shopId).
  async getObjectEntityUploadURL(scope?: string): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }

    const objectId = randomUUID();
    const fullPath = scope
      ? `${privateObjectDir}/uploads/${scope}/${objectId}`
      : `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900,
    });
  }

  /**
   * Sign a PUT URL for an object directly under a caller-supplied prefix.
   * The prefix MUST be a clean relative path segment with no leading slash,
   * no `..` components, and no query/fragment characters.  Throws if it fails
   * validation so callers never accidentally sign outside their namespace.
   *
   * Returns both the signed URL (for the client to PUT to) and the normalised
   * `/objects/…` path that refers to the exact same storage key — there is no
   * post-signing path rewrite.
   *
   * Existing callers of `getObjectEntityUploadURL` are unaffected.
   */
  async getObjectEntityUploadURLWithPrefix(
    prefix: string,
  ): Promise<{ uploadURL: string; objectPath: string }> {
    // Guard against path traversal and other injection.
    if (typeof prefix !== 'string' || !prefix) {
      throw new Error('prefix must be a non-empty string');
    }
    // Reject absolute paths, `..` segments, and any URL-special characters.
    if (
      prefix.startsWith('/') ||
      prefix.includes('..') ||
      /[?#]/.test(prefix) ||
      // Each segment must be non-empty after splitting on /
      prefix.split('/').some((seg) => seg === '')
    ) {
      throw new Error(`Invalid prefix: ${prefix}`);
    }

    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${prefix}/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    const signedURL = await signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900,
    });

    // Derive the canonical /objects/… path from the signed URL so the two
    // values always refer to the same key — no string surgery after signing.
    const objectPath = this.normalizeObjectEntityPath(signedURL);

    return { uploadURL: signedURL, objectPath };
  }

  async saveObjectEntityWithPrefix(
    prefix: string,
    data: Buffer,
    contentType: string,
  ): Promise<string> {
    if (
      typeof prefix !== 'string' ||
      !prefix ||
      prefix.startsWith('/') ||
      prefix.includes('..') ||
      /[?#]/.test(prefix) ||
      prefix.split('/').some((segment) => segment === '')
    ) {
      throw new Error(`Invalid prefix: ${prefix}`);
    }

    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${prefix}/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const objectFile = objectStorageClient.bucket(bucketName).file(objectName);
    await objectFile.save(data, {
      resumable: false,
      metadata: { contentType },
    });
    // Build the entity path from the key we just wrote. `objectFile.publicUrl()`
    // percent-encodes the object name (`%2F` for `/`), which the normaliser
    // does not recognise as living under the private dir, so deriving the path
    // from it persisted raw bucket paths that no client could load.
    return `/objects/uploads/${prefix}/${objectId}`;
  }

  /**
   * Server-side copy of an existing private object into another namespace
   * (e.g. a device photo handed from one shop's `uploads/<shopId>/` to
   * another's on dealer transfer). Bytes never leave the bucket; the copy is
   * a fresh, independently owned object under the target prefix.
   */
  async copyObjectEntityToPrefix(sourceObjectPath: string, prefix: string): Promise<string> {
    if (
      typeof prefix !== 'string' ||
      !prefix ||
      prefix.startsWith('/') ||
      prefix.includes('..') ||
      /[?#]/.test(prefix) ||
      prefix.split('/').some((segment) => segment === '')
    ) {
      throw new Error(`Invalid prefix: ${prefix}`);
    }
    const source = await this.getObjectEntityFile(sourceObjectPath);
    const objectId = randomUUID();
    const fullPath = `${this.getPrivateObjectDir()}/uploads/${prefix}/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    await source.copy(objectStorageClient.bucket(bucketName).file(objectName));
    return `/objects/uploads/${prefix}/${objectId}`;
  }

  /**
   * List private objects below a relative prefix and return their canonical
   * entity paths alongside the provider file handles. Callers should keep the
   * prefix narrow: this method is intended for bounded maintenance jobs, not
   * user-controlled browsing.
   */
  async listObjectEntityFiles(prefix: string): Promise<ListedObjectEntityFile[]> {
    if (
      typeof prefix !== "string" ||
      !prefix ||
      prefix.startsWith("/") ||
      prefix.includes("..") ||
      /[?#]/.test(prefix) ||
      prefix.split("/").some((segment, index, segments) =>
        !segment && index !== segments.length - 1,
      )
    ) {
      throw new Error(`Invalid object listing prefix: ${prefix}`);
    }

    let privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir.endsWith("/")) {
      privateObjectDir = `${privateObjectDir}/`;
    }
    const { bucketName, objectName: listingPrefix } = parseObjectPath(
      `${privateObjectDir}${prefix}`,
    );
    const [files] = await objectStorageClient
      .bucket(bucketName)
      .getFiles({ prefix: listingPrefix });
    const privateObjectPrefix = listingPrefix.slice(
      0,
      listingPrefix.length - prefix.length,
    );

    return files
      .filter((file) => file.name.startsWith(`${privateObjectPrefix}${prefix}`))
      .map((file) => ({
        file,
        objectPath: `/objects/${file.name.slice(privateObjectPrefix.length)}`,
      }));
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith('https://storage.googleapis.com/')) {
      return rawPath;
    }

    const url = new URL(rawPath);
    // Storage URLs may percent-encode the object name (e.g. `%2F` for `/`);
    // compare against the private dir in decoded form.
    let rawObjectPath = url.pathname;
    try {
      rawObjectPath = decodeURIComponent(rawObjectPath);
    } catch {
      // Leave malformed encodings untouched; the prefix check below will
      // simply fail to match.
    }

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/')) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  const pathParts = path.split('/');
  if (pathParts.length < 3) {
    throw new Error('Invalid path: must contain at least a bucket name');
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join('/');

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  ttlSec: number;
}): Promise<string> {
  if (objectStorageProvider === 'gcs') {
    const actionByMethod = {
      GET: 'read',
      HEAD: 'read',
      PUT: 'write',
      DELETE: 'delete',
    } as const;
    const [signedURL] = await objectStorageClient
      .bucket(bucketName)
      .file(objectName)
      .getSignedUrl({
        version: 'v4',
        action: actionByMethod[method],
        expires: Date.now() + ttlSec * 1000,
      });
    return signedURL;
  }

  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`,
    );
  }

  const { signed_url: signedURL } = (await response.json()) as {
    signed_url: string;
  };
  return signedURL;
}
