export type AppReleaseIdentity = {
  version: string;
  buildNumber: number;
  apkPath: string | null;
};

export type AppReleaseIdentityPatch = {
  version?: unknown;
  buildNumber?: unknown;
  apkPath?: unknown;
};

export function requiresFreshApkForIdentityChange(
  release: AppReleaseIdentity,
  patch: AppReleaseIdentityPatch,
): boolean {
  const changesIdentity =
    (typeof patch.version === "string" &&
      patch.version !== release.version) ||
    (typeof patch.buildNumber === "number" &&
      patch.buildNumber !== release.buildNumber);

  return (
    changesIdentity &&
    release.apkPath !== null &&
    (patch.apkPath === undefined || patch.apkPath === release.apkPath)
  );
}

export function reusedApkError(existing: {
  version: string;
  buildNumber: number;
}): string {
  return `This exact APK was already used for v${existing.version} (Build ${existing.buildNumber}). Build a fresh APK from the latest GitHub branch and upload that file; changing release labels does not add new app features.`;
}