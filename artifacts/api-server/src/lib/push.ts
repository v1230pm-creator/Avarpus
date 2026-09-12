// ── Push delivery ────────────────────────────────────────────────────────────
// Every push this server sends is a copy of a notification row that was just
// written for the same recipient. The wording is never composed here: callers
// hand over the row's own title, body and data, so a push can never say more
// than the in-app inbox already says. That matters most for safety alerts —
// "your report was reviewed" must stay outcome-neutral on a lock screen too.
//
// Delivery is best-effort in the strongest sense: nothing in this file is ever
// awaited by a request handler, every failure is swallowed after logging, and
// the mutation that produced the notification has already been committed.

import { and, eq, gt, inArray } from "drizzle-orm";
import { db, pushTokensTable, sessionsTable } from "@workspace/db";

const DEFAULT_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";
// Expo accepts up to 100 messages per request.
const CHUNK_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10_000;
// Push data is a routing hint, not a second copy of the record. Keep it small
// and scalar so nothing bulky or unexpected leaves the server.
const MAX_DATA_KEYS = 10;
const MAX_DATA_VALUE_LENGTH = 200;

export type PushContent = {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export function isPushDeliveryEnabled(): boolean {
  return process.env.DISABLE_PUSH_DELIVERY !== "true";
}

function pushApiUrl(): string {
  return process.env.EXPO_PUSH_API_URL || DEFAULT_PUSH_API_URL;
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

type ExpoTicket = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

// Expo reports a permanently dead installation as DeviceNotRegistered. Keeping
// such a token would mean retrying forever, and — worse — could deliver to a
// device that has since been wiped or handed on.
const DEAD_TOKEN_ERRORS = new Set(["DeviceNotRegistered", "InvalidCredentials"]);

async function dropTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db.delete(pushTokensTable).where(inArray(pushTokensTable.token, tokens));
}

async function sendChunk(tokens: string[], content: PushContent): Promise<void> {
  const messages = tokens.map((to) => ({
    to,
    title: content.title,
    body: content.body,
    data: safeData(content.data, content.type),
    sound: "default",
    priority: "high",
    channelId: "default",
  }));

  const response = await fetch(pushApiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(process.env.EXPO_ACCESS_TOKEN
        ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    // eslint-disable-next-line no-console
    console.error(`push delivery rejected: ${response.status}`);
    return;
  }

  const payload = (await response.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
  const tickets = Array.isArray(payload?.data) ? payload.data : [];
  const dead: string[] = [];
  tickets.forEach((ticket, index) => {
    const token = tokens[index];
    if (!token || ticket?.status !== "error") return;
    const error = ticket.details?.error;
    if (error && DEAD_TOKEN_ERRORS.has(error)) dead.push(token);
    // eslint-disable-next-line no-console
    else console.error(`push ticket error (${error ?? "unknown"}): ${ticket.message ?? ""}`);
  });
  await dropTokens(dead);
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

  // Only devices whose session is still valid may be pushed to. Expired
  // sessions are cleaned up on a schedule, so an expiry check here is what
  // stops a device delivering content after its access has lapsed.
  const rows = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, pushTokensTable.sessionId))
    .where(
      and(
        inArray(pushTokensTable.userId, recipients),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    );
  const tokens = [...new Set(rows.map((row) => row.token))];
  if (tokens.length === 0) return;

  for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
    await sendChunk(tokens.slice(i, i + CHUNK_SIZE), content);
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
