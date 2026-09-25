/**
 * Chat media relay lifecycle rules (pure).
 *
 * The server is a temporary relay for chat media bytes, not an archive.
 * Postgres keeps every message's text and media metadata; only the object in
 * storage is dropped, and only under the rules below. Every decision is made
 * from server-recorded facts (stored receipts, pin flags, tombstones) — time
 * alone never purges anything except through the hard expiry cap.
 *
 * Nothing in this module touches the database or object storage so the rules
 * can be unit-tested exhaustively; `chatRelayCleanup.ts` applies them.
 */

/**
 * First Android build (versionCode) whose app keeps chat media on the device
 * and reports `stored` receipts. Turning the relay purge on before every
 * supported install runs at least this build would make media disappear from
 * older apps, so the settings endpoint and the job both refuse until the
 * update console declares a minimum supported build at or above it.
 *
 * The number is the Android versionCode EAS assigns (`appVersionSource:
 * "remote"` with `autoIncrement` in `artifacts/mobile/eas.json`), not the one
 * written in `app.json`: production installs of app 1.0.8 — the last build
 * without the on-device store — report versionCode 27, so the first build that
 * ships the store is 28 or higher. Confirm against the finished APK's
 * versionCode (`aapt2 dump badging`) when 1.0.9 is built; see replit.md
 * ("Chat media relay purge").
 */
export const CHAT_RELAY_MIN_APP_BUILD = 28;

export type ChatRelayPolicy = {
  /** Master switch. Off means the job does nothing and reports `disabled`. */
  enabled: boolean;
  /** Days after send before media every recipient has stored may be purged. */
  graceDays: number;
  /** Days after send after which media is purged regardless of receipts. */
  expiryDays: number;
};

export const CHAT_RELAY_DEFAULT_POLICY: ChatRelayPolicy = Object.freeze({
  enabled: false,
  graceDays: 7,
  expiryDays: 30,
});

export const CHAT_RELAY_GRACE_DAYS_MIN = 1;
export const CHAT_RELAY_GRACE_DAYS_MAX = 365;
export const CHAT_RELAY_EXPIRY_DAYS_MIN = 1;
export const CHAT_RELAY_EXPIRY_DAYS_MAX = 3650;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Everything the eligibility rule needs to know about one media message. */
export type RelayMediaCandidate = {
  /** Server-owned object path; null means there never was a relay copy. */
  objectPath: string | null;
  /** Current relay state as stored on the row. */
  mediaState: string;
  /** Operator pin (open abuse report). */
  mediaPinned: boolean;
  /** Live check: a report on this message is not yet terminal. */
  hasOpenReport: boolean;
  /** Delete-for-everyone tombstone time, if any. */
  deletedAt: Date | null;
  createdAt: Date;
  /** Current room members other than the sender. */
  recipientCount: number;
  /** Of those recipients, how many have a `stored` receipt. */
  storedRecipientCount: number;
};

export type RelayDecision =
  | { action: "keep"; reason: "no_media" | "not_available" | "pinned" | "waiting" }
  | { action: "purge"; state: "purged" | "expired"; reason: "tombstoned" | "all_stored" | "hard_cap" };

/**
 * Decide what the relay should do with one media message right now.
 *
 * Order matters:
 *  1. Nothing to do without a live relay copy.
 *  2. Pinned media (or media with an open report the flag has not caught up
 *     with) is exempt from every rule, including delete-for-everyone.
 *  3. A tombstoned message has no readers left; its relay copy goes at once.
 *  4. Every recipient stored it and the grace period passed → `purged`.
 *  5. The hard cap passed → `expired`, whatever the receipts say.
 *  6. Otherwise wait.
 */
export function decideRelayMedia(
  candidate: RelayMediaCandidate,
  policy: Pick<ChatRelayPolicy, "graceDays" | "expiryDays">,
  now: Date,
): RelayDecision {
  if (!candidate.objectPath) return { action: "keep", reason: "no_media" };
  if (candidate.mediaState !== "available") return { action: "keep", reason: "not_available" };
  if (candidate.mediaPinned || candidate.hasOpenReport) return { action: "keep", reason: "pinned" };
  if (candidate.deletedAt) return { action: "purge", state: "purged", reason: "tombstoned" };

  const ageMs = now.getTime() - candidate.createdAt.getTime();
  const allStored =
    candidate.recipientCount >= 0 && candidate.storedRecipientCount >= candidate.recipientCount;
  if (allStored && ageMs >= policy.graceDays * DAY_MS) {
    return { action: "purge", state: "purged", reason: "all_stored" };
  }
  if (ageMs >= policy.expiryDays * DAY_MS) {
    return { action: "purge", state: "expired", reason: "hard_cap" };
  }
  return { action: "keep", reason: "waiting" };
}

/** Parse the raw `app_settings` strings into a policy, falling back per key. */
export function parseChatRelayPolicy(raw: {
  enabled?: string | null;
  graceDays?: string | null;
  expiryDays?: string | null;
}): ChatRelayPolicy {
  const enabled = raw.enabled?.trim().toLowerCase() === "true";
  const grace = parseBoundedInt(
    raw.graceDays,
    CHAT_RELAY_GRACE_DAYS_MIN,
    CHAT_RELAY_GRACE_DAYS_MAX,
    CHAT_RELAY_DEFAULT_POLICY.graceDays,
  );
  let expiry = parseBoundedInt(
    raw.expiryDays,
    CHAT_RELAY_EXPIRY_DAYS_MIN,
    CHAT_RELAY_EXPIRY_DAYS_MAX,
    CHAT_RELAY_DEFAULT_POLICY.expiryDays,
  );
  // A stored cap below the grace period could never have been accepted by
  // the settings endpoint; treat it as corrupt and keep the cap at least as
  // long as the grace so the hard rule never fires before the soft one.
  if (expiry < grace) expiry = grace;
  return { enabled, graceDays: grace, expiryDays: expiry };
}

function parseBoundedInt(
  raw: string | null | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw === undefined || raw === null) return fallback;
  const text = raw.trim();
  if (!/^\d{1,6}$/.test(text)) return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

export type ChatRelayPolicyUpdate = {
  enabled: unknown;
  graceDays: unknown;
  expiryDays: unknown;
};

/**
 * Validate an operator's proposed policy. Returns the normalised policy or a
 * human-readable error. The build guard is applied separately because it needs
 * the release table.
 */
export function validateChatRelayPolicyUpdate(
  update: ChatRelayPolicyUpdate,
): { ok: true; policy: ChatRelayPolicy } | { ok: false; message: string } {
  if (typeof update.enabled !== "boolean") {
    return { ok: false, message: "enabled must be true or false." };
  }
  const grace = update.graceDays;
  const expiry = update.expiryDays;
  if (
    typeof grace !== "number" ||
    !Number.isInteger(grace) ||
    grace < CHAT_RELAY_GRACE_DAYS_MIN ||
    grace > CHAT_RELAY_GRACE_DAYS_MAX
  ) {
    return {
      ok: false,
      message: `Grace period must be a whole number of days between ${CHAT_RELAY_GRACE_DAYS_MIN} and ${CHAT_RELAY_GRACE_DAYS_MAX}.`,
    };
  }
  if (
    typeof expiry !== "number" ||
    !Number.isInteger(expiry) ||
    expiry < CHAT_RELAY_EXPIRY_DAYS_MIN ||
    expiry > CHAT_RELAY_EXPIRY_DAYS_MAX
  ) {
    return {
      ok: false,
      message: `Expiry cap must be a whole number of days between ${CHAT_RELAY_EXPIRY_DAYS_MIN} and ${CHAT_RELAY_EXPIRY_DAYS_MAX}.`,
    };
  }
  if (expiry < grace) {
    return { ok: false, message: "Expiry cap must be at least as long as the grace period." };
  }
  return { ok: true, policy: { enabled: update.enabled, graceDays: grace, expiryDays: expiry } };
}

/**
 * Rollout guard. `minimumSupportedBuild` is what the update console currently
 * declares as the oldest build users may still run (null when it has never
 * declared one). Returns a reason the switch must stay off, or null when it
 * may be turned on.
 */
export function chatRelayEnableBlockedReason(
  minimumSupportedBuild: number | null,
  requiredBuild: number = CHAT_RELAY_MIN_APP_BUILD,
): string | null {
  if (minimumSupportedBuild === null || !Number.isFinite(minimumSupportedBuild)) {
    return `No published critical release declares a minimum supported app build yet. Publish build ${requiredBuild} or newer as a critical update before turning the relay purge on.`;
  }
  if (minimumSupportedBuild < requiredBuild) {
    return `The minimum supported app build is ${minimumSupportedBuild}, but on-device chat media requires build ${requiredBuild} or newer. Publish that build as a critical update first.`;
  }
  return null;
}
