// MSG91 OTP provider — server-only module.
// Uses MSG91 v5 SendOTP, Verify OTP, and Retry endpoints via native fetch.
// Credentials (MSG91_AUTH_KEY, MSG91_OTP_TEMPLATE_ID) are read from env at
// call-time so they are never captured in module scope or logged.

const BASE_URL = "https://control.msg91.com/api/v5";
const FETCH_TIMEOUT_MS = 10_000;

/** Normalise an Indian mobile to local 10-digit form stored in the DB. */
export function normaliseIndianMobile(raw: string): string | null {
  const s = raw.trim();
  // Strip country code prefix: +91 or 91 (14 digits) → 10 digits
  if (/^\+91\d{10}$/.test(s)) return s.slice(3);
  if (/^91\d{10}$/.test(s)) return s.slice(2);
  if (/^\d{10}$/.test(s)) return s;
  return null;
}

/** Build the 12-digit number MSG91 expects: 91 + 10-digit local. */
function toMsg91Mobile(local10: string): string {
  return `91${local10}`;
}

function authKey(): string {
  const k = process.env["MSG91_AUTH_KEY"];
  if (!k) throw new Error("MSG91_AUTH_KEY is not configured");
  return k;
}

function templateId(): string {
  const t = process.env["MSG91_OTP_TEMPLATE_ID"];
  if (!t) throw new Error("MSG91_OTP_TEMPLATE_ID is not configured");
  return t;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keep the abort timer active until both response headers and the JSON body
 * arrive. A timeout that ends at headers alone can leave a stalled body read
 * alive after the caller has released its verification reservation.
 */
async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<{ response: Response; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json();
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

export type Msg91Result =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Send a fresh OTP to the given 10-digit local mobile via MSG91 SendOTP.
 * Returns ok:true on success or ok:false with a sanitised reason on failure.
 * Never logs credentials or OTP values.
 */
export async function msg91SendOtp(local10: string): Promise<Msg91Result> {
  const mobile = toMsg91Mobile(local10);
  const url = new URL(`${BASE_URL}/otp`);
  url.searchParams.set("template_id", templateId());
  url.searchParams.set("mobile", mobile);

  let res: Response;
  try {
    res = await fetchWithTimeout(url.toString(), {
      method: "POST",
      headers: { authkey: authKey(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    return { ok: false, reason: `MSG91 send failed: ${msg}` };
  }

  if (!res.ok) {
    return { ok: false, reason: `MSG91 send returned HTTP ${res.status}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "MSG91 send returned invalid JSON" };
  }

  const data = body as Record<string, unknown>;
  // MSG91 v5 returns { "type": "success" } on success
  if (data["type"] === "success" || data["message"] === "success") {
    return { ok: true };
  }
  // Surface only the MSG91 type/message field, never raw body that may contain secrets
  const safeReason = typeof data["message"] === "string"
    ? data["message"]
    : String(data["type"] ?? "unknown MSG91 error");
  return { ok: false, reason: `MSG91 send error: ${safeReason}` };
}

/**
 * Verify an OTP code with MSG91.
 * Returns ok:true when the provider approves, ok:false otherwise.
 */
export async function msg91VerifyOtp(
  local10: string,
  code: string,
): Promise<Msg91Result> {
  const mobile = toMsg91Mobile(local10);
  const url = new URL(`${BASE_URL}/otp/verify`);
  url.searchParams.set("mobile", mobile);
  url.searchParams.set("otp", code);

  let result: { response: Response; body: unknown };
  try {
    result = await fetchJsonWithTimeout(url.toString(), {
      method: "GET",
      headers: { authkey: authKey() },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    return { ok: false, reason: `MSG91 verify failed: ${msg}` };
  }

  if (!result.response.ok) {
    return { ok: false, reason: `MSG91 verify returned HTTP ${result.response.status}` };
  }

  const data = result.body as Record<string, unknown>;
  if (data["type"] === "success" || data["message"] === "success") {
    return { ok: true };
  }
  const safeReason = typeof data["message"] === "string"
    ? data["message"]
    : String(data["type"] ?? "unknown MSG91 error");
  return { ok: false, reason: `MSG91 verify error: ${safeReason}` };
}

/**
 * Retry (resend) an OTP via MSG91 Retry endpoint.
 * retryType: "voice" | "text" (defaults to "text")
 */
export async function msg91RetryOtp(
  local10: string,
  retryType: "voice" | "text" = "text",
): Promise<Msg91Result> {
  const mobile = toMsg91Mobile(local10);
  const url = new URL(`${BASE_URL}/otp/retry`);
  url.searchParams.set("mobile", mobile);
  url.searchParams.set("retrytype", retryType);

  let res: Response;
  try {
    res = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: { authkey: authKey() },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    return { ok: false, reason: `MSG91 retry failed: ${msg}` };
  }

  if (!res.ok) {
    return { ok: false, reason: `MSG91 retry returned HTTP ${res.status}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "MSG91 retry returned invalid JSON" };
  }

  const data = body as Record<string, unknown>;
  if (data["type"] === "success" || data["message"] === "success") {
    return { ok: true };
  }
  const safeReason = typeof data["message"] === "string"
    ? data["message"]
    : String(data["type"] ?? "unknown MSG91 error");
  return { ok: false, reason: `MSG91 retry error: ${safeReason}` };
}
