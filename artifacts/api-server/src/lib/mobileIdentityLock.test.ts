import { describe, expect, it, vi } from "vitest";

vi.mock("./hanuOtp", () => ({
  normaliseIndianMobile: (value: string) => {
    const v = value.trim();
    if (/^\+91\d{10}$/.test(v)) return v.slice(3);
    return /^\d{10}$/.test(v) ? v : null;
  },
}));

const { normalizedMobileLockKeys } = await import("./mobileIdentityLock");

describe("normalized mobile advisory lock keys", () => {
  it("normalizes, de-duplicates, rejects invalid values, and sorts deterministically", () => {
    expect(normalizedMobileLockKeys("9876543210", "+919123456789", "bad", "9123456789"))
      .toEqual(["9123456789", "9876543210"]);
  });
});