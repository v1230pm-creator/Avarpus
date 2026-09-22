import { describe, expect, it } from "vitest";
import {
  CHAT_RELAY_DEFAULT_POLICY,
  CHAT_RELAY_MIN_APP_BUILD,
  chatRelayEnableBlockedReason,
  decideRelayMedia,
  parseChatRelayPolicy,
  validateChatRelayPolicyUpdate,
  type RelayMediaCandidate,
} from "./chatRelayPolicy";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-22T12:00:00.000Z");
const policy = { graceDays: 7, expiryDays: 30 };

function candidate(overrides: Partial<RelayMediaCandidate> = {}): RelayMediaCandidate {
  return {
    objectPath: "/objects/uploads/global/chat/room/obj",
    mediaState: "available",
    mediaPinned: false,
    hasOpenReport: false,
    deletedAt: null,
    createdAt: new Date(now.getTime() - 10 * DAY),
    recipientCount: 1,
    storedRecipientCount: 1,
    ...overrides,
  };
}

describe("decideRelayMedia", () => {
  it("purges once every recipient stored it and the grace period passed", () => {
    expect(decideRelayMedia(candidate(), policy, now)).toEqual({
      action: "purge",
      state: "purged",
      reason: "all_stored",
    });
  });

  it("waits while the grace period is still running even if all stored", () => {
    const c = candidate({ createdAt: new Date(now.getTime() - 6 * DAY) });
    expect(decideRelayMedia(c, policy, now)).toEqual({ action: "keep", reason: "waiting" });
  });

  it("purges exactly at the grace boundary", () => {
    const c = candidate({ createdAt: new Date(now.getTime() - 7 * DAY) });
    expect(decideRelayMedia(c, policy, now).action).toBe("purge");
  });

  it("waits while a recipient has not stored it, until the hard cap", () => {
    const waiting = candidate({ recipientCount: 2, storedRecipientCount: 1 });
    expect(decideRelayMedia(waiting, policy, now)).toEqual({ action: "keep", reason: "waiting" });
    const capped = candidate({
      recipientCount: 2,
      storedRecipientCount: 1,
      createdAt: new Date(now.getTime() - 30 * DAY),
    });
    expect(decideRelayMedia(capped, policy, now)).toEqual({
      action: "purge",
      state: "expired",
      reason: "hard_cap",
    });
  });

  it("reports all-stored media past the cap as purged, not expired", () => {
    const c = candidate({ createdAt: new Date(now.getTime() - 45 * DAY) });
    expect(decideRelayMedia(c, policy, now)).toMatchObject({ state: "purged" });
  });

  it("treats a room with no other members as fully stored", () => {
    const c = candidate({ recipientCount: 0, storedRecipientCount: 0 });
    expect(decideRelayMedia(c, policy, now)).toMatchObject({ action: "purge", state: "purged" });
  });

  it("never touches pinned media, however old, even when tombstoned", () => {
    const old = new Date(now.getTime() - 400 * DAY);
    expect(
      decideRelayMedia(candidate({ mediaPinned: true, createdAt: old }), policy, now),
    ).toEqual({ action: "keep", reason: "pinned" });
    expect(
      decideRelayMedia(candidate({ hasOpenReport: true, createdAt: old }), policy, now),
    ).toEqual({ action: "keep", reason: "pinned" });
    expect(
      decideRelayMedia(
        candidate({ hasOpenReport: true, deletedAt: now, createdAt: old }),
        policy,
        now,
      ),
    ).toEqual({ action: "keep", reason: "pinned" });
  });

  it("purges a delete-for-everyone tombstone immediately", () => {
    const c = candidate({
      deletedAt: now,
      createdAt: new Date(now.getTime() - 60_000),
      recipientCount: 3,
      storedRecipientCount: 0,
    });
    expect(decideRelayMedia(c, policy, now)).toEqual({
      action: "purge",
      state: "purged",
      reason: "tombstoned",
    });
  });

  it("does nothing for rows without media or already purged rows", () => {
    expect(decideRelayMedia(candidate({ objectPath: null }), policy, now)).toEqual({
      action: "keep",
      reason: "no_media",
    });
    expect(decideRelayMedia(candidate({ mediaState: "purged" }), policy, now)).toEqual({
      action: "keep",
      reason: "not_available",
    });
    expect(decideRelayMedia(candidate({ mediaState: "expired" }), policy, now)).toEqual({
      action: "keep",
      reason: "not_available",
    });
  });
});

describe("parseChatRelayPolicy", () => {
  it("defaults to OFF / 7 / 30 when nothing is stored", () => {
    expect(parseChatRelayPolicy({})).toEqual(CHAT_RELAY_DEFAULT_POLICY);
    expect(parseChatRelayPolicy({}).enabled).toBe(false);
  });

  it("reads stored values and rejects garbage per key", () => {
    expect(parseChatRelayPolicy({ enabled: "true", graceDays: "3", expiryDays: "90" })).toEqual({
      enabled: true,
      graceDays: 3,
      expiryDays: 90,
    });
    expect(parseChatRelayPolicy({ enabled: "yes", graceDays: "-1", expiryDays: "abc" })).toEqual(
      CHAT_RELAY_DEFAULT_POLICY,
    );
    expect(parseChatRelayPolicy({ graceDays: "0", expiryDays: "99999" })).toEqual(
      CHAT_RELAY_DEFAULT_POLICY,
    );
  });

  it("never lets the hard cap fire before the grace period", () => {
    expect(parseChatRelayPolicy({ graceDays: "60", expiryDays: "10" })).toMatchObject({
      graceDays: 60,
      expiryDays: 60,
    });
  });
});

describe("validateChatRelayPolicyUpdate", () => {
  it("accepts a sane policy", () => {
    expect(validateChatRelayPolicyUpdate({ enabled: true, graceDays: 7, expiryDays: 30 })).toEqual({
      ok: true,
      policy: { enabled: true, graceDays: 7, expiryDays: 30 },
    });
  });

  it("rejects non-integers, out-of-range values and a cap below the grace", () => {
    expect(validateChatRelayPolicyUpdate({ enabled: "true", graceDays: 7, expiryDays: 30 }).ok).toBe(false);
    expect(validateChatRelayPolicyUpdate({ enabled: false, graceDays: 1.5, expiryDays: 30 }).ok).toBe(false);
    expect(validateChatRelayPolicyUpdate({ enabled: false, graceDays: 0, expiryDays: 30 }).ok).toBe(false);
    expect(validateChatRelayPolicyUpdate({ enabled: false, graceDays: 7, expiryDays: 4000 }).ok).toBe(false);
    expect(validateChatRelayPolicyUpdate({ enabled: false, graceDays: 10, expiryDays: 9 })).toMatchObject({
      ok: false,
      message: expect.stringContaining("at least as long"),
    });
  });
});

describe("chatRelayEnableBlockedReason", () => {
  it("blocks without a declared minimum build or with one that predates on-device media", () => {
    expect(chatRelayEnableBlockedReason(null)).toContain(String(CHAT_RELAY_MIN_APP_BUILD));
    expect(chatRelayEnableBlockedReason(CHAT_RELAY_MIN_APP_BUILD - 1)).toContain("requires build");
  });

  it("allows once the minimum supported build carries on-device media", () => {
    expect(chatRelayEnableBlockedReason(CHAT_RELAY_MIN_APP_BUILD)).toBeNull();
    expect(chatRelayEnableBlockedReason(CHAT_RELAY_MIN_APP_BUILD + 5)).toBeNull();
  });
});
