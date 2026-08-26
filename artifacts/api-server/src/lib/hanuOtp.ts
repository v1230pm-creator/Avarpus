// Hanu OTP provider — server-only module.
// Hanu's API sends an OTP supplied by the caller; verification is therefore
// performed locally against the hashed, expiring OTP record in the database.
// The API key is read at call-time so it is never captured in module scope or
// logged.

const DEFAULT_ENDPOINT = "https://api.hanuotp.in/sms-otp.php";
const FETCH_TIMEOUT_MS = 10_000;

export function normaliseIndianMobile(raw: string): string | null {
  const s = raw.trim();
  if (/^\+91\d{10}$/.test(s)) return s.slice(3);
  if (/^91\d{10}$/.test(s)) return s.slice(2);
  if (/^\d{10}$/.test(s)) return s;
  return null;
}

function endpoint(): string {
  return process.env["HANU_OTP_ENDPOINT"] || DEFAULT_ENDPOINT;
}

function apiKey(): string | null {
  const key = process.env["HANU_OTP_API_KEY"]?.trim();
  return key || null;
}

function templateId(): string {
  return process.env["HANU_OTP_TEMPLATE_ID"]?.trim() || "default";
}

export type HanuOtpResult =
  | { ok: true }
  | { ok: false; reason: string };

export type HanuOtpStatus = {
  provider: "Hanu OTP";
  configured: boolean;
  endpoint: string;
  templateId: string;
  apiKeyConfigured: boolean;
};

export function getHanuOtpStatus(): HanuOtpStatus {
  return {
    provider: "Hanu OTP",
    configured: Boolean(apiKey()),
    endpoint: endpoint(),
    templateId: templateId(),
    apiKeyConfigured: Boolean(apiKey()),
  };
}

function safeResponseMessage(body: unknown): string {
  if (typeof body === "string") {
    return body.slice(0, 160);
  }
  if (body && typeof body === "object") {
    const data = body as Record<string, unknown>;
    for (const key of ["message", "error", "status"]) {
      if (typeof data[key] === "string" && data[key].trim()) {
        return data[key].slice(0, 160);
      }
    }
  }
  return "unknown Hanu OTP response";
}

function responseIsSuccessful(body: unknown): boolean {
  if (typeof body === "string") return /\bsuccess\b|\bsent\b/i.test(body);
  if (!body || typeof body !== "object") return false;
  const data = body as Record<string, unknown>;
  return (
    data["status"] === "success" ||
    data["status"] === "ok" ||
    data["success"] === true ||
    data["message"] === "success"
  );
}

/**
 * Send the supplied six-digit OTP to a local 10-digit Indian mobile.
 * Hanu expects the mobile number without the +91 country prefix.
 */
export async function hanuSendOtp(
  local10: string,
  code: string,
): Promise<HanuOtpResult> {
  const key = apiKey();
  if (!key) return { ok: false, reason: "HANU_OTP_API_KEY is not configured" };

  const url = new URL(endpoint());
  url.searchParams.set("number", local10);
  url.searchParams.set("OTP", code);
  url.searchParams.set("apikey", key);
  url.searchParams.set("templatesid", templateId());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "network error";
      return { ok: false, reason: `Hanu OTP send failed: ${message}` };
    }

    const rawBody = await response.text();
    let body: unknown = rawBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      // Hanu may return a plain-text success response; parse below.
    }

    if (!response.ok) {
      return { ok: false, reason: `Hanu OTP returned HTTP ${response.status}` };
    }
    if (responseIsSuccessful(body)) return { ok: true };
    return { ok: false, reason: `Hanu OTP error: ${safeResponseMessage(body)}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid provider response";
    return { ok: false, reason: `Hanu OTP send failed: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}