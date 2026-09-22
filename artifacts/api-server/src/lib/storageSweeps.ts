/**
 * Decides whether this process may run the scheduled jobs that DELETE objects
 * from object storage (abandoned Chat/Profile-staging uploads, orphaned
 * Status media, the chat relay purge).
 *
 * Every environment of this project shares ONE bucket (the private object
 * directory is a shared secret), but each environment has its OWN database.
 * A sweep decides "unreferenced" by looking at its own database, so a sweep
 * running in the development workspace treats every production object as
 * abandoned and deletes it. That is exactly how production profile photos
 * disappeared. Destructive sweeps therefore run only where the database and
 * the bucket belong together: the Replit production deployment, or a host
 * that opts in explicitly.
 *
 * - `OBJECT_STORAGE_SWEEPS=on`  → run (self-hosted production with its own bucket)
 * - `OBJECT_STORAGE_SWEEPS=off` → never run, even in the deployment
 * - unset                        → run only when `REPLIT_DEPLOYMENT=1`
 */
export type StorageSweepPolicy =
  | { enabled: true; reason: "OBJECT_STORAGE_SWEEPS=on" | "replit-deployment" }
  | { enabled: false; reason: "OBJECT_STORAGE_SWEEPS=off" | "shared-bucket-outside-deployment" };

export function resolveStorageSweepPolicy(
  env: Record<string, string | undefined> = process.env,
): StorageSweepPolicy {
  const raw = env["OBJECT_STORAGE_SWEEPS"]?.trim().toLowerCase();
  if (raw === "on") return { enabled: true, reason: "OBJECT_STORAGE_SWEEPS=on" };
  if (raw === "off") return { enabled: false, reason: "OBJECT_STORAGE_SWEEPS=off" };
  if (raw) {
    throw new Error(
      `OBJECT_STORAGE_SWEEPS must be "on" or "off" (got "${env["OBJECT_STORAGE_SWEEPS"]}")`,
    );
  }
  if (env["REPLIT_DEPLOYMENT"] === "1") {
    return { enabled: true, reason: "replit-deployment" };
  }
  return { enabled: false, reason: "shared-bucket-outside-deployment" };
}

/**
 * Thrown by a storage-deleting primitive that was invoked while sweeps are
 * disabled here. Callers that reach the primitive outside the scheduler (the
 * operator "Run now" endpoint) must surface it, never swallow it.
 */
export class StorageSweepsDisabledError extends Error {
  readonly reason: Extract<StorageSweepPolicy, { enabled: false }>["reason"];
  constructor(reason: Extract<StorageSweepPolicy, { enabled: false }>["reason"]) {
    super(`Object storage sweeps are disabled on this server (${reason})`);
    this.name = "StorageSweepsDisabledError";
    this.reason = reason;
  }
}

/** Resolves the policy and throws when destructive storage work must not run. */
export function assertStorageSweepsEnabled(
  policy: StorageSweepPolicy = resolveStorageSweepPolicy(),
): void {
  if (!policy.enabled) throw new StorageSweepsDisabledError(policy.reason);
}
