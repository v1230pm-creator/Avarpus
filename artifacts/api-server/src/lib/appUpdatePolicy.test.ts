import { describe, expect, it } from "vitest";
import {
  requiresFreshApkForIdentityChange,
  reusedApkError,
} from "./appUpdatePolicy";

const release = {
  version: "1.0.1",
  buildNumber: 15,
  apkPath: "/objects/uploads/app-updates/old-apk",
};

describe("app update release identity policy", () => {
  it("blocks relabelling an attached APK as a newer release", () => {
    expect(
      requiresFreshApkForIdentityChange(release, {
        version: "1.0.2",
        buildNumber: 16,
        apkPath: release.apkPath,
      }),
    ).toBe(true);
  });

  it("allows an identity change when a different APK is attached", () => {
    expect(
      requiresFreshApkForIdentityChange(release, {
        version: "1.0.2",
        buildNumber: 16,
        apkPath: "/objects/uploads/app-updates/fresh-apk",
      }),
    ).toBe(false);
  });

  it("explains that changing labels cannot add features", () => {
    expect(
      reusedApkError({ version: "1.0.1", buildNumber: 15 }),
    ).toContain("changing release labels does not add new app features");
  });
});