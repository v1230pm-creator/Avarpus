/**
 * Chat provider utilities — Matrix/Element Server Suite (ESS) Pro and LiveKit.
 *
 * Provider-dependent operations FAIL CLOSED with explicit 503 when
 * credentials are absent. No fake data is ever stored or returned.
 *
 * E2EE is deferred: all operations return e2eeEnabled: false.
 *
 * ── Matrix Application Service (AS) model ─────────────────────────────────────
 * We integrate with Matrix STRICTLY as a registered Application Service against
 * an ESS/Synapse homeserver. There is NO admin-token masquerading: every room
 * and message operation is performed as a deterministic *virtual user* inside a
 * documented appservice namespace, using the AS access token plus the
 * Client-Server API `?user_id=` sender-impersonation query parameter.
 *
 * Operators MUST register this service with the homeserver via an appservice
 * registration YAML whose user namespace covers `@appuser-.*` and whose room
 * alias namespace covers `#appchat-.*` (see the prefixes below), and whose
 * `as_token` matches MATRIX_APP_SERVICE_TOKEN. The homeserver `server_name`
 * MUST equal MATRIX_SERVER_NAME.
 *
 * Environment variables:
 *   MATRIX_BASE_URL            — homeserver Client-Server API base,
 *                                e.g. https://matrix.example.com
 *   MATRIX_SERVER_NAME         — the homeserver server_name (the domain part of
 *                                user/room IDs), e.g. example.com. This is the
 *                                registration `server_name`, NOT necessarily the
 *                                hostname of MATRIX_BASE_URL.
 *   MATRIX_APP_SERVICE_TOKEN   — the appservice `as_token` from the ESS/Synapse
 *                                appservice registration. Used as the Bearer
 *                                token for ALL Matrix operations. NEVER logged.
 *   MATRIX_HOMESERVER_TOKEN    — the registration `hs_token`. Used only to
 *                                authenticate homeserver-to-AS callbacks.
 *   MATRIX_APP_SERVICE_URL     — stable public callback base URL from the
 *                                registration, e.g. https://api.example.com/api/matrix/appservice
 *   LIVEKIT_URL                — e.g. wss://livekit.example.com
 *   LIVEKIT_API_KEY            — LiveKit API key
 *   LIVEKIT_API_SECRET         — LiveKit API secret
 *
 * NOTE: MATRIX_ADMIN_TOKEN is intentionally NOT used for any client operation.
 * Admin-token impersonation via `?user_id=` only works for a registered AS
 * token and would otherwise make the admin/provisioning identity a room member.
 */

import crypto from "node:crypto";

/**
 * Appservice user namespace prefix. Every virtual user localpart begins with
 * this prefix so a single ESS/Synapse appservice registration regex
 * (`@appuser-.*:<server_name>`) claims the whole namespace.
 */
export const MATRIX_APPSERVICE_NAMESPACE_PREFIX = "appuser-";
export const MATRIX_DIRECT_ROOM_ALIAS_PREFIX = "appchat-";

/**
 * Hard deadline for a complete Matrix room-provisioning attempt.  This is an
 * upper bound, rather than a retry interval: a provider outage must not leave
 * API requests (or their database connections) waiting indefinitely.
 *
 * Operators may lower this through MATRIX_PROVISION_TIMEOUT_MS for their
 * network, but it is clamped to 100ms–10s so configuration cannot accidentally
 * remove the safety bound.
 */
const DEFAULT_MATRIX_PROVISION_TIMEOUT_MS = 5_000;
const MIN_MATRIX_PROVISION_TIMEOUT_MS = 100;
const MAX_MATRIX_PROVISION_TIMEOUT_MS = 10_000;

export function matrixProvisionTimeoutMs(): number {
  const configured = Number(process.env.MATRIX_PROVISION_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MATRIX_PROVISION_TIMEOUT_MS;
  }
  return Math.min(
    MAX_MATRIX_PROVISION_TIMEOUT_MS,
    Math.max(MIN_MATRIX_PROVISION_TIMEOUT_MS, Math.floor(configured)),
  );
}

// ── Credential checks ─────────────────────────────────────────────────────────

/**
 * Matrix is "configured" only when we have EVERYTHING required to act as a
 * registered Application Service: the CS API base URL, an explicit server_name,
 * and the appservice as_token. We deliberately do NOT consider an admin token —
 * client operations must go through the AS token or they cannot legally
 * impersonate virtual users.
 */
/**
 * Log-safe description of a failed provider call. Node's fetch reports every
 * transport failure as the opaque "fetch failed"; the actionable detail
 * (ENOTFOUND, ECONNREFUSED, certificate errors, timeouts) sits on `cause`.
 * Never includes tokens or response bodies.
 */
export function describeProviderError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.name === "TimeoutError" || err.name === "AbortError" ? `${err.name}: ${err.message}` : err.message];
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    const syscall = (cause as NodeJS.ErrnoException).syscall;
    parts.push(`cause=${[code, syscall].filter(Boolean).join("/") || cause.name}: ${cause.message}`);
  }
  return parts.join(" | ");
}

export function matrixConfigured(): boolean {
  return !!(
    process.env.MATRIX_BASE_URL?.trim() &&
    process.env.MATRIX_SERVER_NAME?.trim() &&
    process.env.MATRIX_APP_SERVICE_TOKEN?.trim() &&
    process.env.MATRIX_HOMESERVER_TOKEN?.trim() &&
    process.env.MATRIX_APP_SERVICE_URL?.trim()
  );
}

export type MatrixConfigurationStatus = {
  configured: boolean;
  baseUrl: "ok" | "missing" | "invalid";
  serverName: "ok" | "missing" | "invalid";
  appServiceUrl: "ok" | "missing" | "invalid";
  appServiceToken: "ok" | "missing";
  homeserverToken: "ok" | "missing";
  userNamespace: string;
  aliasNamespace: string;
};

export type MatrixOutboundAuthStatus = {
  outboundAuth: "ok" | "failed" | "unavailable";
  httpStatus?: number;
  errcode?: string;
  failure?: "timeout" | "network";
};

function httpUrlStatus(value: string | undefined): "ok" | "missing" | "invalid" {
  if (!value?.trim()) return "missing";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? "ok" : "invalid";
  } catch {
    return "invalid";
  }
}

export function matrixConfigurationStatus(): MatrixConfigurationStatus {
  const serverName = process.env.MATRIX_SERVER_NAME?.trim();
  const serverNameStatus =
    !serverName
      ? "missing"
      : /^[a-z0-9.-]+(?::\d+)?$/i.test(serverName) && !serverName.includes("/")
        ? "ok"
        : "invalid";
  return {
    configured: matrixConfigured(),
    baseUrl: httpUrlStatus(process.env.MATRIX_BASE_URL),
    serverName: serverNameStatus,
    appServiceUrl: httpUrlStatus(process.env.MATRIX_APP_SERVICE_URL),
    appServiceToken: process.env.MATRIX_APP_SERVICE_TOKEN?.trim() ? "ok" : "missing",
    homeserverToken: process.env.MATRIX_HOMESERVER_TOKEN?.trim() ? "ok" : "missing",
    userNamespace: `^@${MATRIX_APPSERVICE_NAMESPACE_PREFIX}[a-f0-9]{32}:${serverName || "<server_name>"}$`,
    aliasNamespace: `^#${MATRIX_DIRECT_ROOM_ALIAS_PREFIX}[a-f0-9]{40}:${serverName || "<server_name>"}$`,
  };
}

/**
 * Verify that this process's AS token is accepted by the configured homeserver.
 * The result intentionally excludes response bodies and token material so it is
 * safe to expose from the homeserver-token-protected diagnostic route.
 */
export async function matrixOutboundAuthStatus(): Promise<MatrixOutboundAuthStatus> {
  if (!matrixConfigured()) {
    return { outboundAuth: "unavailable" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), matrixProvisionTimeoutMs());
  try {
    const resp = await fetch(matrixUrl("/_matrix/client/v3/account/whoami"), {
      method: "GET",
      headers: matrixHeaders(),
      signal: controller.signal,
    });
    if (resp.ok) {
      return { outboundAuth: "ok", httpStatus: resp.status };
    }

    let errcode = "";
    try {
      const body = (await resp.json()) as { errcode?: unknown };
      if (typeof body.errcode === "string") errcode = body.errcode;
    } catch {
      // A non-JSON provider response is represented by its HTTP status only.
    }
    return {
      outboundAuth: "failed",
      httpStatus: resp.status,
      ...(errcode ? { errcode } : {}),
    };
  } catch (error) {
    return {
      outboundAuth: "failed",
      failure:
        error instanceof Error && error.name === "AbortError" ? "timeout" : "network",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function livekitConfigured(): boolean {
  return !!(
    process.env.LIVEKIT_URL?.trim() &&
    process.env.LIVEKIT_API_KEY?.trim() &&
    process.env.LIVEKIT_API_SECRET?.trim()
  );
}

export function chatCapabilities() {
  return {
    e2eeEnabled: false as const,
    matrixAvailable: matrixConfigured(),
    livekitAvailable: livekitConfigured(),
  };
}

// ── Matrix provider (Application Service) ─────────────────────────────────────

function requireMatrixConfigured(): void {
  if (!matrixConfigured()) {
    const err = new Error("Matrix provider not configured");
    (err as NodeJS.ErrnoException).code = "PROVIDER_UNAVAILABLE";
    throw err;
  }
}

/**
 * Authorization header for the appservice. Uses the AS token exclusively.
 * The token value is NEVER logged.
 */
function matrixHeaders() {
  return {
    Authorization: `Bearer ${process.env.MATRIX_APP_SERVICE_TOKEN!}`,
    "Content-Type": "application/json",
  };
}

function matrixUrl(path: string): string {
  const base = process.env.MATRIX_BASE_URL!.replace(/\/$/, "");
  return `${base}${path}`;
}

/**
 * Append the AS sender-impersonation query param to a CS API path. The provided
 * user_id MUST fall inside the appservice namespace or the homeserver rejects
 * the request (M_EXCLUSIVE / M_FORBIDDEN).
 */
function withUserId(path: string, matrixUserId: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}user_id=${encodeURIComponent(matrixUserId)}`;
}

/**
 * The homeserver server_name (the domain segment of user/room IDs). This is an
 * EXPLICIT configuration value; we never infer it from the base URL hostname,
 * because the CS API host and the server_name frequently differ (e.g. a
 * delegated `matrix.example.com` serving `example.com`).
 */
export function matrixServerName(): string {
  return process.env.MATRIX_SERVER_NAME!.trim();
}

/**
 * Deterministic Matrix user id for an application user. The localpart is derived
 * from the app user id (prefixed with the appservice namespace prefix) so it is
 * stable, collision-free per server, and inside the registered AS namespace.
 */
export function matrixUserIdForApp(appUserId: string): string {
  return `@${matrixLocalpartForApp(appUserId)}:${matrixServerName()}`;
}

/** Localpart (without @…:server) inside the appservice namespace. */
export function matrixLocalpartForApp(appUserId: string): string {
  return `${MATRIX_APPSERVICE_NAMESPACE_PREFIX}${appUserId.replace(/-/g, "")}`;
}

/**
 * The deterministic alias localpart for a direct-room reservation. The
 * provision key is a SHA-256 hex value generated and durably stored by the
 * API before Matrix work begins. Truncation remains collision-resistant while
 * keeping the alias comfortably inside Matrix localpart limits.
 */
export function matrixDirectRoomAliasLocalpart(provisionKey: string): string {
  if (!/^[a-f0-9]{32,}$/i.test(provisionKey)) {
    throw new Error("Invalid Matrix direct-room provision key");
  }
  return `${MATRIX_DIRECT_ROOM_ALIAS_PREFIX}${provisionKey.slice(0, 40).toLowerCase()}`;
}

export function matrixDirectRoomAlias(provisionKey: string): string {
  return `#${matrixDirectRoomAliasLocalpart(provisionKey)}:${matrixServerName()}`;
}

/**
 * Resolve an app-owned direct-room alias. A missing alias is a normal result;
 * all other provider failures remain explicit so callers never guess at a
 * room from mutable metadata such as its name or topic.
 */
export async function matrixResolveDirectRoomAlias(
  provisionKey: string,
  signal?: AbortSignal,
): Promise<string | null> {
  requireMatrixConfigured();
  const alias = matrixDirectRoomAlias(provisionKey);
  const resp = await fetch(
    matrixUrl(`/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`),
    { method: "GET", headers: matrixHeaders(), signal },
  );
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Matrix room alias lookup failed: ${resp.status} ${body}`);
  }
  const data = (await resp.json()) as { room_id?: unknown };
  if (typeof data.room_id !== "string" || !data.room_id) {
    throw new Error("Matrix room alias lookup returned no room_id");
  }
  return data.room_id;
}

/**
 * Ensure a virtual user exists via the Client-Server AS registration flow
 * (`m.login.application_service`). Idempotent: a homeserver that already knows
 * the user returns HTTP 400 with errcode `M_USER_IN_USE`, which we treat as
 * success. Optionally set the display name (best-effort, via AS impersonation).
 *
 * Reference: POST /_matrix/client/v3/register with
 *   { type: "m.login.application_service", username: <localpart> }
 * authenticated with the AS token.
 */
export async function matrixEnsureVirtualUser(opts: {
  localpart: string;
  displayName?: string;
  signal?: AbortSignal;
}): Promise<string> {
  requireMatrixConfigured();
  const matrixUserId = `@${opts.localpart}:${matrixServerName()}`;

  const resp = await fetch(matrixUrl("/_matrix/client/v3/register"), {
    method: "POST",
    headers: matrixHeaders(),
    body: JSON.stringify({
      type: "m.login.application_service",
      username: opts.localpart,
    }),
    signal: opts.signal,
  });

  if (!resp.ok) {
    let errcode = "";
    const raw = await resp.text().catch(() => "");
    try {
      errcode = (JSON.parse(raw) as { errcode?: string }).errcode ?? "";
    } catch {
      errcode = "";
    }
    // Already-registered is the idempotent happy path for an AS re-provision.
    if (!(resp.status === 400 && errcode === "M_USER_IN_USE")) {
      throw new Error(
        `Matrix ensureVirtualUser failed: ${resp.status} ${errcode || raw}`,
      );
    }
  }

  // Best-effort display name via AS impersonation. Non-fatal on failure so a
  // benign profile-set error never blocks room provisioning.
  if (opts.displayName && opts.displayName.trim()) {
    try {
      await fetch(
        matrixUrl(
          withUserId(
            `/_matrix/client/v3/profile/${encodeURIComponent(matrixUserId)}/displayname`,
            matrixUserId,
          ),
        ),
        {
          method: "PUT",
          headers: matrixHeaders(),
          body: JSON.stringify({ displayname: opts.displayName.slice(0, 100) }),
          signal: opts.signal,
        },
      );
    } catch {
      // Ignore display-name errors — the user exists, which is what matters.
      // An aborted provisioning deadline is not a benign profile error: the
      // caller needs to know it happened before createRoom is attempted.
      if (opts.signal?.aborted) throw new Error("Matrix display-name request aborted");
    }
  }

  return matrixUserId;
}

/**
 * Create a private/direct room AS the initiating virtual user (impersonated via
 * `?user_id=`) and invite exactly the target virtual user in the same call.
 * Returns the Matrix room_id string.
 *
 * The creator becomes the sole room creator/member; the target is invited (and
 * must subsequently join). No admin/provisioning identity ever appears.
 */
export async function matrixCreateDirectRoom(opts: {
  name: string;
  topic: string;
  /** Matrix user_id of the creating (initiating) virtual participant. */
  creatorUserId: string;
  /** Matrix user_id of the invited (target) virtual participant. */
  inviteUserId: string;
  /** App-owned deterministic alias localpart; makes create/recovery idempotent. */
  roomAliasLocalpart: string;
  signal?: AbortSignal;
}): Promise<string> {
  requireMatrixConfigured();
  const resp = await fetch(
    matrixUrl(withUserId("/_matrix/client/v3/createRoom", opts.creatorUserId)),
    {
      method: "POST",
      headers: matrixHeaders(),
      body: JSON.stringify({
        name: opts.name,
        topic: opts.topic,
        preset: "trusted_private_chat",
        visibility: "private",
        is_direct: true,
        room_alias_name: opts.roomAliasLocalpart,
        invite: [opts.inviteUserId],
        initial_state: [],
      }),
      signal: opts.signal,
    },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    // A concurrent/recovered creator may already have claimed the deterministic
    // alias. Resolve that exact alias rather than attempting another create.
    if (resp.status === 400 && body.includes("M_ROOM_IN_USE")) {
      const existing = await matrixResolveDirectRoomAlias(
        opts.roomAliasLocalpart.slice(MATRIX_DIRECT_ROOM_ALIAS_PREFIX.length),
        opts.signal,
      );
      if (existing) return existing;
    }
    throw new Error(`Matrix createRoom failed: ${resp.status} ${body}`);
  }
  const data = (await resp.json()) as { room_id: string };
  return data.room_id;
}

/**
 * Join a room AS the given virtual user (impersonated via `?user_id=`) using the
 * Client-Server API join endpoint. Idempotent: an already-joined user yields a
 * 200 from the homeserver.
 *
 * Reference: POST /_matrix/client/v3/rooms/{roomId}/join?user_id=<target>
 */
export async function matrixJoinRoomAs(
  matrixRoomId: string,
  matrixUserId: string,
  signal?: AbortSignal,
): Promise<void> {
  requireMatrixConfigured();
  const resp = await fetch(
    matrixUrl(
      withUserId(
        `/_matrix/client/v3/rooms/${encodeURIComponent(matrixRoomId)}/join`,
        matrixUserId,
      ),
    ),
    {
      method: "POST",
      headers: matrixHeaders(),
      body: JSON.stringify({}),
      signal,
    },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Matrix joinRoom failed: ${resp.status} ${body}`);
  }
}

/**
 * Return the set of joined member Matrix IDs for a room via the Client-Server
 * API. Read AS the initiating virtual user (impersonated via `?user_id=`) so we
 * never require an admin identity.
 *
 * Reference: GET /_matrix/client/v3/rooms/{roomId}/joined_members
 */
export async function matrixJoinedMembers(
  matrixRoomId: string,
  asUserId: string,
  signal?: AbortSignal,
): Promise<string[]> {
  requireMatrixConfigured();
  const resp = await fetch(
    matrixUrl(
      withUserId(
        `/_matrix/client/v3/rooms/${encodeURIComponent(matrixRoomId)}/joined_members`,
        asUserId,
      ),
    ),
    {
      method: "GET",
      headers: matrixHeaders(),
      signal,
    },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Matrix joinedMembers failed: ${resp.status} ${body}`);
  }
  const data = (await resp.json()) as {
    joined?: Record<string, unknown>;
  };
  return Object.keys(data.joined ?? {});
}

/**
 * Provision a private/direct room for EXACTLY the two given virtual
 * participants using pure Application Service semantics, then verify the
 * homeserver's joined member set is exactly those two IDs before returning.
 *
 * Ordering:
 *   1. Ensure both virtual users exist (idempotent AS registration).
 *   2. Create the room AS the initiator, inviting exactly the target.
 *   3. Join AS the target.
 *   4. Read joined_members and FAIL CLOSED unless it equals {initiator, target}.
 *
 * Throws on ANY provider error or membership mismatch. An unexpected third
 * member (e.g. a leaked admin/provisioning identity) causes a hard failure so
 * no local room is ever persisted.
 */
export async function matrixProvisionDirectRoom(opts: {
  name: string;
  topic: string;
  provisionKey: string;
  initiator: { appUserId: string; displayName: string };
  target: { appUserId: string; displayName: string };
}): Promise<{
  matrixRoomId: string;
  initiatorUserId: string;
  targetUserId: string;
}> {
  requireMatrixConfigured();
  const timeout = matrixProvisionTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let phase: "ensure" | "lookup" | "create" | "join" | "members" = "ensure";

  try {
    const initiatorLocalpart = matrixLocalpartForApp(opts.initiator.appUserId);
    const targetLocalpart = matrixLocalpartForApp(opts.target.appUserId);

    const initiatorUserId = await matrixEnsureVirtualUser({
      localpart: initiatorLocalpart,
      displayName: opts.initiator.displayName,
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      throw new Error("Matrix initiator ensure timed out");
    }
    const targetUserId = await matrixEnsureVirtualUser({
      localpart: targetLocalpart,
      displayName: opts.target.displayName,
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      throw new Error("Matrix target ensure timed out");
    }

    const roomAliasLocalpart = matrixDirectRoomAliasLocalpart(opts.provisionKey);
    phase = "lookup";
    let matrixRoomId = await matrixResolveDirectRoomAlias(opts.provisionKey, controller.signal);
    if (!matrixRoomId) {
      phase = "create";
      matrixRoomId = await matrixCreateDirectRoom({
        name: opts.name,
        topic: opts.topic,
        creatorUserId: initiatorUserId,
        inviteUserId: targetUserId,
        roomAliasLocalpart,
        signal: controller.signal,
      });
    }

    phase = "join";
    await matrixJoinRoomAs(matrixRoomId, targetUserId, controller.signal);

    // Fail closed: the homeserver membership MUST be exactly the two virtual
    // participants. Any other identity (admin/provisioning bot leak) aborts.
    phase = "members";
    const members = await matrixJoinedMembers(matrixRoomId, initiatorUserId, controller.signal);
    const expected = new Set([initiatorUserId, targetUserId]);
    const actual = new Set(members);
    const exactlyTwo =
      actual.size === 2 &&
      expected.size === 2 &&
      [...expected].every((id) => actual.has(id));
    if (!exactlyTwo) {
      const err = new Error(
        `Matrix room membership mismatch: expected exactly 2 members ` +
          `[${initiatorUserId}, ${targetUserId}], got ${actual.size}`,
      );
      (err as NodeJS.ErrnoException).code = "MATRIX_MEMBERSHIP_MISMATCH";
      throw err;
    }

    return { matrixRoomId, initiatorUserId, targetUserId };
  } catch (error) {
    if (controller.signal.aborted) {
      const err = new Error(`Matrix room provisioning timed out after ${timeout}ms`, {
        cause: error,
      });
      (err as NodeJS.ErrnoException).code =
        phase === "ensure" ? "MATRIX_ENSURE_TIMEOUT" : "MATRIX_TIMEOUT";
      throw err;
    }
    const providerError = error as NodeJS.ErrnoException;
    if (!providerError.code) {
      providerError.code =
        phase === "ensure"
          ? "MATRIX_ENSURE_FAILED"
          : phase === "create" || phase === "lookup"
            ? "MATRIX_CREATE_FAILED"
            : phase === "join"
              ? "MATRIX_JOIN_FAILED"
              : "MATRIX_MEMBERS_FAILED";
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a message to a Matrix room via the Client-Server API AS the sender
 * virtual user (impersonated via `?user_id=`). Returns the Matrix event_id.
 *
 * IMPORTANT: this is the ONLY path that persists messages. The caller MUST NOT
 * write a local row before calling this — if the Matrix send fails, no row is
 * written. The event_id returned is stored as provider_event_id.
 *
 * Throws (PROVIDER_UNAVAILABLE) when credentials are absent.
 * Throws (MATRIX_SEND_FAILED) on any HTTP error from Matrix.
 */
export async function matrixSendMessage(opts: {
  matrixRoomId: string;
  /** Matrix user_id of the sender, e.g. @localpart:server */
  senderUserId: string;
  msgtype: "m.text" | "m.image" | "m.file" | "m.audio";
  body: string;
  /** For m.image / m.file / m.audio: the mxc:// URI or fallback URL */
  url?: string;
  /**
   * Optional content `info` block. For m.audio voice notes we populate
   * `{ duration: <ms> }` per the Matrix spec (EventContent m.audio info.duration
   * is expressed in milliseconds). Merged into the event content under `info`.
   */
  info?: Record<string, unknown>;
  /**
   * Matrix event id of the message being replied to. Emitted as the spec's
   * rich-reply relation (`m.relates_to.m.in_reply_to.event_id`).
   */
  inReplyToEventId?: string;
  /**
   * Deterministic transaction id. Matrix treats a repeated (txnId) from the
   * same sender as the same event, so retries never create a second event.
   * REQUIRED — callers derive it from roomId+senderId+clientRequestId.
   */
  txnId: string;
  signal?: AbortSignal;
}): Promise<string> {
  requireMatrixConfigured();
  // Use the AS impersonation query param (?user_id=) so the event appears from
  // the correct virtual user rather than the appservice bot.
  const txnId = encodeURIComponent(opts.txnId);
  const url = matrixUrl(
    withUserId(
      `/_matrix/client/v3/rooms/${encodeURIComponent(opts.matrixRoomId)}/send/m.room.message/${txnId}`,
      opts.senderUserId,
    ),
  );
  const content: Record<string, unknown> = {
    msgtype: opts.msgtype,
    body: opts.body,
  };
  if (opts.url) {
    content.url = opts.url;
  }
  if (opts.info && Object.keys(opts.info).length > 0) {
    content.info = opts.info;
  }
  if (opts.inReplyToEventId) {
    content["m.relates_to"] = {
      "m.in_reply_to": { event_id: opts.inReplyToEventId },
    };
  }
  const resp = await fetch(url, {
    method: "PUT",
    headers: matrixHeaders(),
    body: JSON.stringify(content),
    signal: opts.signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`Matrix sendMessage failed: ${resp.status} ${text}`);
    (err as NodeJS.ErrnoException).code = "MATRIX_SEND_FAILED";
    throw err;
  }
  const data = (await resp.json()) as { event_id: string };
  return data.event_id;
}

/**
 * Deterministic Matrix transaction id for an idempotent send. Derived from the
 * room, sender and client request id, so concurrent retries collapse to a
 * single Matrix event.
 */
export function matrixTxnId(
  roomId: string,
  senderId: string,
  clientRequestId: string,
): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${roomId}|${senderId}|${clientRequestId}`)
    .digest("hex");
  return `app-${hash.slice(0, 40)}`;
}

/**
 * Redact (delete for everyone) a message event AS its original sender. Matrix
 * strips the content from the event for every member; the local tombstone is
 * written only after this succeeds. Redaction PUTs are idempotent on txnId.
 *
 * Throws (PROVIDER_UNAVAILABLE) when credentials are absent.
 * Throws (MATRIX_REDACT_FAILED) on any HTTP error from Matrix.
 */
export async function matrixRedactEvent(opts: {
  matrixRoomId: string;
  senderUserId: string;
  eventId: string;
  txnId: string;
  reason?: string;
  signal?: AbortSignal;
}): Promise<void> {
  requireMatrixConfigured();
  const url = matrixUrl(
    withUserId(
      `/_matrix/client/v3/rooms/${encodeURIComponent(opts.matrixRoomId)}/redact/${encodeURIComponent(opts.eventId)}/${encodeURIComponent(opts.txnId)}`,
      opts.senderUserId,
    ),
  );
  const resp = await fetch(url, {
    method: "PUT",
    headers: matrixHeaders(),
    body: JSON.stringify(opts.reason ? { reason: opts.reason } : {}),
    signal: opts.signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`Matrix redact failed: ${resp.status} ${text}`);
    (err as NodeJS.ErrnoException).code = "MATRIX_REDACT_FAILED";
    throw err;
  }
}

// ── LiveKit call token ────────────────────────────────────────────────────────

const LIVEKIT_TOKEN_TTL_SECONDS = 3600; // 1 hour

/**
 * Mint a short-lived LiveKit access token (HS256 JWT) server-side.
 * Never relies on any external library — uses Node.js built-in crypto.
 *
 * The token grants the user permission to join the specified room.
 * Fails closed (throws) when LiveKit credentials are not configured.
 */
export function livekitMintToken(opts: {
  roomName: string;
  participantIdentity: string;
  participantName: string;
}): string {
  if (!livekitConfigured()) {
    const err = new Error("LiveKit provider not configured");
    (err as NodeJS.ErrnoException).code = "PROVIDER_UNAVAILABLE";
    throw err;
  }
  const apiKey = process.env.LIVEKIT_API_KEY!;
  const apiSecret = process.env.LIVEKIT_API_SECRET!;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };

  // LiveKit video grants
  const videoGrant = {
    roomJoin: true,
    room: opts.roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  };

  const payload = {
    iss: apiKey,
    sub: opts.participantIdentity,
    iat: now,
    exp: now + LIVEKIT_TOKEN_TTL_SECONDS,
    nbf: now,
    jti: crypto.randomUUID(),
    name: opts.participantName,
    video: videoGrant,
  };

  const b64Header = base64UrlEncode(JSON.stringify(header));
  const b64Payload = base64UrlEncode(JSON.stringify(payload));
  const sigInput = `${b64Header}.${b64Payload}`;
  const sig = crypto
    .createHmac("sha256", apiSecret)
    .update(sigInput)
    .digest("base64url");

  return `${sigInput}.${sig}`;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
