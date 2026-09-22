import { describe, expect, it } from "vitest";
import { resolveStorageSweepPolicy } from "./storageSweeps";

describe("resolveStorageSweepPolicy", () => {
  it("runs sweeps only inside the Replit deployment by default", () => {
    expect(resolveStorageSweepPolicy({})).toEqual({
      enabled: false,
      reason: "shared-bucket-outside-deployment",
    });
    expect(resolveStorageSweepPolicy({ NODE_ENV: "production" })).toMatchObject({ enabled: false });
    expect(resolveStorageSweepPolicy({ REPLIT_DEPLOYMENT: "1" })).toEqual({
      enabled: true,
      reason: "replit-deployment",
    });
  });

  it("honours an explicit switch in either direction", () => {
    expect(resolveStorageSweepPolicy({ OBJECT_STORAGE_SWEEPS: "on" })).toMatchObject({ enabled: true });
    expect(resolveStorageSweepPolicy({ OBJECT_STORAGE_SWEEPS: " ON " })).toMatchObject({ enabled: true });
    expect(resolveStorageSweepPolicy({ OBJECT_STORAGE_SWEEPS: "off", REPLIT_DEPLOYMENT: "1" })).toEqual({
      enabled: false,
      reason: "OBJECT_STORAGE_SWEEPS=off",
    });
  });

  it("refuses a malformed switch instead of guessing", () => {
    expect(() => resolveStorageSweepPolicy({ OBJECT_STORAGE_SWEEPS: "yes" })).toThrow(/OBJECT_STORAGE_SWEEPS/);
  });
});
