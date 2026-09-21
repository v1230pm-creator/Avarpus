// ── Push delivery ────────────────────────────────────────────────────────────
// Every push this server sends is a copy of a notification row that was just
// written for the same recipient. The wording is never composed here: callers
// hand over the row's own title, body and data, so a push can never say more
// than the in-app inbox already says. That matters most for safety alerts —
// "your report was reviewed" must stay outcome-neutral on a lock screen too.
//
// The one thing this file may do to the wording is *remove* from it: when a
// recipient has turned message previews off, a chat push keeps the sender and
// replaces the text with a neutral count. It never adds.
//
// Delivery is best-effort in the strongest sense: nothing in this file is ever
// awaited by a request handler, every failure is swallowed after logging, and
// the mutation that produced the notification has already been committed.
//
// Transport is the Expo Push Service (which forwards to FCM / APNs using the
// credentials uploaded for this app on expo.dev). There is exactly one push
// architecture in this codebase; do not add a direct FCM path beside it.

import { and, eq, gt, inArray } from "drizzle-orm";
import {
  db,
  notificationPreferencesTable,
  pushTokensTable,
  sessionsTable,
  usersTable,
  type DbNotificationPreferences,
  type DbUser,
} from "@workspace/db";
import { isPrivilegedSessionIdle } from "./authUtils";
import { dealerPortalDealerIsActive, isDealerPortalRole } from "./dealerPortal";
import { userHasFeature } from "./roleFeatures";

const DEFAULT_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";
// Expo accepts up to 100 messages per request.
const CHUNK_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10_000;
// One retry, only for failures where the provider provably never accepted the
// batch (connection refused, 429/5xx). A timed-out request is *not* retried:
// the provider may have accepted it, and a duplicate buzz is worse than a
// delayed one — the in-app inbox still has the row either way.
const RETRY_DELAY_MS = 1_500;
// Expo asks senders to check receipts ~15 minutes after sending; a receipt is
// where a token that FCM has since invalidated shows up.
const RECEIPT_CHECK_DELAY_MS = 15 * 60 * 1000;
// Push data is a routing hint, not a second copy of the record. Keep it small
// and scalar so nothing bulky or unexpected leaves the server.
const MAX_DATA_KEYS = 12;
const MAX_DATA_VALUE_LENGTH = 200;
const MAX_LAST_ERROR_LENGTH = 160;

// ── Categories and channels ──────────────────────────────────────────────────
// Every notification type maps to one product category. The category decides
// (a) which per-account toggle can silence it and (b) which Android channel the
// device files it under. `general` has no toggle: it carries account security
// and moderation outcomes that a user must not be able to mute by accident.
export type PushCategory =
  | "messages"
  | "calls"
  | "dealer"
  | "repair"
  | "payments"
  | "status"
  | "general";

export function pushCategoryFor(type: string): PushCategory {
  if (type === "chat_message") return "messages";
  if (type.startsWith("call")) return "calls";
  if (type.startsWith("dealer_")) return "dealer";
  if (type.startsWith("status")) return "status";
  if (
    type === "repair_payment" ||
    type === "repair_payment_void" ||
    type === "repair_bill" ||
    type === "payment_recorded" ||
    type === "refund" ||
    type === "income" ||
    type === "expense"
  ) {
    return "payments";
  }
  if (type.startsWith("repair") || type.startsWith("approval")) return "repair";
  return "general";
}

// Android channel ids the app registers. Status alerts share the general
// channel; the category still has its own toggle. Channel settings are frozen
// once created, so sound/vibration preferences select a variant rather than
// mutate a channel.
export const PUSH_CHANNEL_IDS = {
  messages: "avarpus_messages",
  calls: "avarpus_calls",
  dealer: "avarpus_dealer",
  repair: "avarpus_repair",
  payments: "avarpus_payments",
  status: "avarpus_general",
  general: "avarpus_general",
} as const satisfies Record<PushCategory, string>;

export type ChannelVariant = "" | "_silent" | "_novibrate" | "_quiet";

export function channelVariantFor(prefs: { sound: boolean; vibration: boolean }): ChannelVariant {
  if (prefs.sound && prefs.vibration) return "";
  if (!prefs.sound && prefs.vibration) return "_silent";
  if (prefs.sound && !prefs.vibration) return "_novibrate";
  return "_quiet";
}

export function channelIdFor(
  category: PushCategory,
  prefs: { sound: boolean; vibration: boolean },
): string {
  return `${PUSH_CHANNEL_IDS[category]}${channelVariantFor(prefs)}`;
}

// The bundled premium chime (assets/sounds/avarpus_message.wav in the app).
// iOS reads the `sound` field; Android reads it from the channel.
export const MESSAGE_SOUND = "avarpus_message.wav";

export type PushPreferences = Pick<
  DbNotificationPreferences,
  | "messages"
  | "calls"
  | "dealer"
  | "repair"
  | "payments"
  | "status"
  | "showPreview"
  | "sound"
  | "vibration"
>;

export const DEFAULT_PUSH_PREFERENCES: PushPreferences = {
  messages: true,
  calls: true,
  dealer: true,
  repair: true,
  payments: true,
  status: true,
  showPreview: true,
  sound: true,
  vibration: true,
};

function categoryEnabled(prefs: PushPreferences, category: PushCategory): boolean {
  if (category === "general") return true;
  return prefs[category];
}

export async function loadPushPreferences(
  userIds: string[],
): Promise<Map<string, PushPreferences>> {
  const out = new Map<string, PushPreferences>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select()
    .from(notificationPreferencesTable)
    .where(inArray(notificationPreferencesTable.userId, userIds));
  for (const row of rows) out.set(row.userId, row);
  return out;
}

// ── Content ──────────────────────────────────────────────────────────────────

export type PushContent = {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // Total unread chat count for this recipient (app icon badge). Only the
  // chat producer knows it; other producers leave it unset and the badge is
  // left alone.
  badge?: number;
  // Unread count in the same thread, used for the preview-off wording.
  threadUnread?: number;
};

export function isPushDeliveryEnabled(): boolean {
  return process.env.DISABLE_PUSH_DELIVERY !== "true";
}

function pushApiUrl(): string {
  return process.env.EXPO_PUSH_API_URL || DEFAULT_PUSH_API_URL;
}

function pushReceiptsUrl(): string {
  return process.env.EXPO_PUSH_RECEIPTS_URL || pushApiUrl().replace(/\/send$/, "/getReceipts");
}

// Expo push tokens are opaque, but their envelope is fixed. Validating the
// shape keeps obviously bogus registrations (and other services' tokens) out
// of the table.
const EXPO_TOKEN_PATTERN = /^Exp(?:o|onent)PushToken\[[A-Za-z0-9._-]{1,120}\]$/;

export function isValidExpoPushToken(value: unknown): value is string {
  return typeof value === "string" && EXPO_TOKEN_PATTERN.test(value);
}

// Carry only scalars, capped in count and length. The in-app row keeps the
// full payload; the push only needs enough to open the right screen.
function safeData(data: Record<string, unknown> | undefined, type: string): Record<string, unknown> {
  const out: Record<string, unknown> = { type };
  for (const [key, value] of Object.entries(data ?? {})) {
    if (Object.keys(out).length >= MAX_DATA_KEYS) break;
    if (key === "type") continue;
    if (typeof value === "string") out[key] = value.slice(0, MAX_DATA_VALUE_LENGTH);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

// Preview-off wording for a chat push: sender stays, text goes. The count is
// the recipient's unread messages in that thread, so a burst reads
// "3 new messages" instead of three identical "New message" rows.
export function maskedMessageBody(threadUnread: number | undefined): string {
  const n = Math.max(1, Math.floor(threadUnread ?? 1));
  return n > 1 ? `${n} new messages` : "New message";
}

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: string | null;
  priority: "high";
  channelId: string;
  badge?: number;
  // Android: collapse pushes of the same thread into one entry.
  collapseId?: string;
};

export function buildExpoMessage(
  token: string,
  content: PushContent,
  prefs: PushPreferences,
): ExpoMessage {
  const category = pushCategoryFor(content.type);
  const hidePreview = category === "messages" && !prefs.showPreview;
  const body = hidePreview ? maskedMessageBody(content.threadUnread) : content.body;
  const sound = !prefs.sound
    ? null
    : category === "messages"
      ? MESSAGE_SOUND
      : "default";
  const data = safeData(content.data, content.type);
  const message: ExpoMessage = {
    to: token,
    title: content.title,
    body,
    data: { ...data, ...(hidePreview ? { previewHidden: true } : {}) },
    sound,
    priority: "high",
    channelId: channelIdFor(category, prefs),
  };
  if (typeof content.badge === "number" && Number.isFinite(content.badge)) {
    message.badge = Math.max(0, Math.floor(content.badge));
  }
  const roomId = data.roomId;
  if (category === "messages" && typeof roomId === "string" && roomId) {
    message.collapseId = `chat-room:${roomId}`;
  }
  return message;
}

// ── Transport ────────────────────────────────────────────────────────────────

type ExpoTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
};

// Expo reports a permanently dead installation as DeviceNotRegistered. Keeping
// such a token would mean retrying forever, and — worse — could deliver to a
// device that has since been wiped or handed on. InvalidCredentials is NOT a
// dead token: it means the project's FCM/APNs credentials are wrong, which is
// an operator problem affecting every device. Deleting registrations for it
// would silently unsubscribe the whole user base until they sign in again.
const DEAD_TOKEN_ERRORS = new Set(["DeviceNotRegistered"]);
const CREDENTIAL_ERRORS = new Set(["InvalidCredentials"]);

async function dropTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db.delete(pushTokensTable).where(inArray(pushTokensTable.token, tokens));
}

async function markSent(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db
    .update(pushTokensTable)
    .set({ lastSentAt: new Date(), lastError: null, lastErrorAt: null })
    .where(inArray(pushTokensTable.token, tokens));
}

async function markError(tokens: string[], error: string): Promise<void> {
  if (tokens.length === 0) return;
  await db
    .update(pushTokensTable)
    .set({ lastError: error.slice(0, MAX_LAST_ERROR_LENGTH), lastErrorAt: new Date() })
    .where(inArray(pushTokensTable.token, tokens));
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(process.env.EXPO_ACCESS_TOKEN
      ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
      : {}),
  };
}

const PRE_CONNECT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

function isPreConnectFailure(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } })?.cause;
  const code = cause?.code ?? (err as { code?: string })?.code;
  return typeof code === "string" && PRE_CONNECT_ERROR_CODES.has(code);
}

class RetryableProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableProviderError";
  }
}

async function postMessages(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
  let response: Response;
  try {
    response = await fetch(pushApiUrl(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Only a failure proven to happen before any bytes reached the provider
    // may be retried: a timeout or a mid-request reset is ambiguous (Expo may
    // already have accepted the batch) and resending would duplicate alerts.
    if (isPreConnectFailure(err)) {
      throw new RetryableProviderError(`push provider unreachable: ${(err as Error)?.message ?? err}`);
    }
    throw err;
  }
  if (response.status === 429 || response.status >= 500) {
    throw new RetryableProviderError(`push provider rejected batch: ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`push delivery rejected: ${response.status}`);
  }
  const payload = (await response.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
  return Array.isArray(payload?.data) ? payload.data : [];
}

// Tickets whose receipt still has to be checked. Kept in memory on purpose: a
// process restart simply skips one round of receipt checks, and the next send
// to a dead token is reported as DeviceNotRegistered again.
const pendingReceipts: Array<{ ticketId: string; token: string }> = [];
let receiptTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReceiptCheck(): void {
  if (receiptTimer || pendingReceipts.length === 0) return;
  receiptTimer = setTimeout(() => {
    receiptTimer = null;
    void checkPendingReceipts().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("push receipt check failed:", err);
    });
  }, RECEIPT_CHECK_DELAY_MS);
  receiptTimer.unref?.();
}

// Awaitable so an integration check can drive it with a stubbed provider.
export async function checkPendingReceipts(): Promise<void> {
  if (pendingReceipts.length === 0) return;
  const batch = pendingReceipts.splice(0, 1000);
  const byTicket = new Map(batch.map((entry) => [entry.ticketId, entry.token]));
  const response = await fetch(pushReceiptsUrl(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ids: [...byTicket.keys()] }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return;
  const payload = (await response.json().catch(() => null)) as
    | { data?: Record<string, ExpoTicket> }
    | null;
  const dead: string[] = [];
  const failed: Array<{ token: string; error: string }> = [];
  for (const [ticketId, receipt] of Object.entries(payload?.data ?? {})) {
    const token = byTicket.get(ticketId);
    if (!token || receipt?.status !== "error") continue;
    const error = receipt.details?.error ?? "unknown";
    if (DEAD_TOKEN_ERRORS.has(error)) dead.push(token);
    else failed.push({ token, error: `receipt: ${error}` });
  }
  await dropTokens(dead);
  for (const entry of failed) await markError([entry.token], entry.error);
  if (pendingReceipts.length > 0) scheduleReceiptCheck();
}

async function sendChunk(messages: ExpoMessage[]): Promise<void> {
  const tokens = messages.map((message) => message.to);
  let tickets: ExpoTicket[];
  try {
    tickets = await postMessages(messages);
  } catch (err) {
    if (!(err instanceof RetryableProviderError)) {
      await markError(tokens, (err as Error)?.message ?? "push failed");
      throw err;
    }
    // eslint-disable-next-line no-console
    console.warn(`${err.message}; retrying once`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      tickets = await postMessages(messages);
    } catch (retryErr) {
      await markError(tokens, (retryErr as Error)?.message ?? "push failed");
      throw retryErr;
    }
  }

  const dead: string[] = [];
  const sent: string[] = [];
  const errored: Array<{ token: string; error: string }> = [];
  tickets.forEach((ticket, index) => {
    const token = tokens[index];
    if (!token) return;
    if (ticket?.status === "error") {
      const error = ticket.details?.error ?? "unknown";
      if (DEAD_TOKEN_ERRORS.has(error)) dead.push(token);
      else {
        errored.push({ token, error: `${error}: ${ticket.message ?? ""}`.trim() });
        // eslint-disable-next-line no-console
        console.error(
          CREDENTIAL_ERRORS.has(error)
            ? `push credentials rejected by provider (${error}); check FCM/APNs credentials on the Expo project — device tokens kept: ${ticket.message ?? ""}`
            : `push ticket error (${error}): ${ticket.message ?? ""}`,
        );
      }
      return;
    }
    sent.push(token);
    if (typeof ticket?.id === "string" && ticket.id) {
      pendingReceipts.push({ ticketId: ticket.id, token });
    }
  });
  await Promise.all([
    dropTokens(dead),
    markSent(sent),
    ...errored.map((entry) => markError([entry.token], entry.error)),
  ]);
  if (dead.length > 0) {
    // eslint-disable-next-line no-console
    console.info(`push: retired ${dead.length} dead device token(s)`);
  }
  scheduleReceiptCheck();
}

// ── Recipient resolution ─────────────────────────────────────────────────────

type DeviceRow = { token: string; userId: string };

// Only devices whose session would still pass requireAuth may be pushed to.
// Expired sessions are cleaned up on a schedule, so an expiry check here is
// what stops a device delivering content after its access has lapsed. The
// same goes for the other read-time rules — a deactivated account, an idle
// privileged session, a dealer whose portal access the shop switched off —
// none of which revoke the session row itself. Devices that reported
// notifications as switched off keep their row but are skipped.
async function liveDevices(userIds: string[]): Promise<DeviceRow[]> {
  const now = new Date();
  const rows = await db
    .select({
      token: pushTokensTable.token,
      userId: pushTokensTable.userId,
      lastSeenAt: sessionsTable.lastSeenAt,
      user: usersTable,
    })
    .from(pushTokensTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, pushTokensTable.sessionId))
    .innerJoin(usersTable, eq(usersTable.id, pushTokensTable.userId))
    .where(
      and(
        inArray(pushTokensTable.userId, userIds),
        eq(pushTokensTable.notificationsEnabled, true),
        eq(usersTable.isActive, true),
        gt(sessionsTable.expiresAt, now),
      ),
    );

  const portalAllowed = new Map<string, Promise<boolean>>();
  const portalAccess = (user: DbUser): Promise<boolean> => {
    let pending = portalAllowed.get(user.id);
    if (!pending) {
      pending = dealerPortalDealerIsActive(user)
        .then((active) => (active ? userHasFeature(user, "portal_repairs") : false))
        .catch(() => false);
      portalAllowed.set(user.id, pending);
    }
    return pending;
  };

  const live: DeviceRow[] = [];
  for (const row of rows) {
    if (isPrivilegedSessionIdle(row.user.role, row.lastSeenAt, now)) continue;
    if (isDealerPortalRole(row.user.role) && !(await portalAccess(row.user))) continue;
    live.push({ token: row.token, userId: row.userId });
  }
  return live;
}

// Awaitable form, used by integration checks. Request handlers must use
// dispatchPushToUsers instead so nothing waits on a push provider.
export async function deliverPushToUsers(
  userIds: string[],
  content: PushContent,
): Promise<void> {
  if (!isPushDeliveryEnabled()) return;
  const recipients = [...new Set(userIds.filter(Boolean))];
  if (recipients.length === 0) return;

  const category = pushCategoryFor(content.type);
  const prefsByUser = await loadPushPreferences(recipients);
  const allowed = recipients.filter((userId) =>
    categoryEnabled(prefsByUser.get(userId) ?? DEFAULT_PUSH_PREFERENCES, category),
  );
  if (allowed.length === 0) return;

  const devices = await liveDevices(allowed);
  if (devices.length === 0) return;

  const seen = new Set<string>();
  const messages: ExpoMessage[] = [];
  for (const device of devices) {
    if (seen.has(device.token)) continue;
    seen.add(device.token);
    const prefs = prefsByUser.get(device.userId) ?? DEFAULT_PUSH_PREFERENCES;
    messages.push(buildExpoMessage(device.token, content, prefs));
  }

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    await sendChunk(messages.slice(i, i + CHUNK_SIZE));
  }
}

// Fire-and-forget entry point. Never await this: the notification row is the
// durable record, and push is the optional extra that must not add latency to
// — or ever fail — the mutation that produced it.
export function dispatchPushToUsers(userIds: string[], content: PushContent): void {
  void deliverPushToUsers(userIds, content).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("push delivery failed:", err);
  });
}

// Sign-out and session revocation drop tokens through the sessions cascade.
// This is the explicit path for a device that asks to stop receiving push
// while keeping its session (e.g. the user turns notifications off).
export async function removePushToken(userId: string, token: string): Promise<void> {
  await db
    .delete(pushTokensTable)
    .where(and(eq(pushTokensTable.userId, userId), eq(pushTokensTable.token, token)));
}
