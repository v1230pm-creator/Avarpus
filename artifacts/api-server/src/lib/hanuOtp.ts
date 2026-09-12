// Hanu OTP provider — server-only module.
// Hanu's API sends an OTP supplied by the caller; verification is therefore
// performed locally against the hashed, expiring OTP record in the database.
// The API key is read at call-time so it is never captured in module scope or
// logged.

const HANU_OTP_ENDPOINT = "https://api.hanuotp.in/sms-otp.php";
const HANU_DEFAULT_TEMPLATE_ID = "default";
const FETCH_TIMEOUT_MS = 10_000;

// The SMS provider only delivers to 10-digit Indian mobile numbers starting
// with 6-9. Accepting anything looser here just moves the rejection to the
// provider, where it surfaces to the user as an unexplained send failure.
const INDIAN_MOBILE_LOCAL = /^[6-9]\d{9}$/;

export function normaliseIndianMobile(raw: string): string | null {
  // Callers paste numbers with spaces, dashes and brackets from contact lists.
  const compact = raw.trim().replace(/[\s()\-.]/g, "");

  let local: string | null = null;
  if (/^\+?91\d{10}$/.test(compact)) local = compact.slice(-10);
  else if (/^0\d{10}$/.test(compact)) local = compact.slice(1);
  else if (/^\d{10}$/.test(compact)) local = compact;

  return local && INDIAN_MOBILE_LOCAL.test(local) ? local : null;
}

function apiKey(): string | null {
  const key = process.env["HANU_OTP_API_KEY"]?.trim();
  return key || null;
}

function templateId(): string {
  return process.env["HANU_OTP_TEMPLATE_ID"]?.trim() || HANU_DEFAULT_TEMPLATE_ID;
}

export type HanuOtpResult =
  | { ok: true; providerMessage: string; providerReference: string | null }
  // `invalidNumber` marks a refusal the caller can fix by correcting the
  // number, so the API can say that instead of "try again shortly".
  | { ok: false; reason: string; invalidNumber: boolean };

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
    endpoint: HANU_OTP_ENDPOINT,
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
    if (Array.isArray(data["message"])) {
      const firstMessage = data["message"].find(
        (value) => typeof value === "string" && value.trim(),
      );
      if (typeof firstMessage === "string") return firstMessage.slice(0, 160);
    }
    for (const key of ["message", "error", "status"]) {
      if (typeof data[key] === "string" && data[key].trim()) {
        return data[key].slice(0, 160);
      }
    }
  }
  return "unknown Hanu OTP response";
}

// The provider reports an unusable destination in prose rather than a code.
// Recognising it lets the API answer "fix the number" instead of "try again".
function providerRejectedTheNumber(providerMessage: string): boolean {
  return /invalid\s+(mobile|phone)?\s*number|number\s+is\s+invalid|invalid\s+recipient/i.test(
    providerMessage,
  );
}

function responseIsSuccessful(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const data = body as Record<string, unknown>;
  return (
    data["status"] === "success" ||
    data["status"] === "ok" ||
    data["return"] === true ||
    data["success"] === true ||
    data["message"] === "success"
  );
}

function safeSuccessDetails(body: unknown): {
  providerMessage: string;
  providerReference: string | null;
} {
  if (!body || typeof body !== "object") {
    return { providerMessage: "success", providerReference: null };
  }
  const data = body as Record<string, unknown>;
  const providerMessage = safeResponseMessage(body);
  const referenceKeys = ["request_id", "requestId", "message_id", "messageId", "id"];
  const reference = referenceKeys
    .map((key) => data[key])
    .find((value) => typeof value === "string" || typeof value === "number");
  return {
    providerMessage,
    providerReference:
      typeof reference === "string" || typeof reference === "number"
        ? String(reference).slice(0, 100)
        : null,
  };
}

/**
 * Send the supplied six-digit OTP to a local 10-digit Indian mobile.
 * Hanu's live SMS API requires a local 10-digit Indian number.
 */
export async function hanuSendOtp(
  local10: string,
  code: string,
): Promise<HanuOtpResult> {
  const key = apiKey();
  if (!key) {
    return {
      ok: false,
      reason: "HANU_OTP_API_KEY is not configured",
      invalidNumber: false,
    };
  }
  const url = new URL(HANU_OTP_ENDPOINT);
  url.searchParams.set("number", local10);
  url.searchParams.set("OTP", code);
  url.searchParams.set("apikey", key);
  // The live endpoint currently requires this even though the public SMS
  // reference omits it.
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
      return {
        ok: false,
        reason: `Hanu OTP send failed: ${message}`,
        invalidNumber: false,
      };
    }

    const rawBody = await response.text();
    let body: unknown = rawBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      // Hanu may return a plain-text success response; parse below.
    }

    if (!response.ok) {
      // The provider also refuses malformed numbers with an HTTP error, so the
      // body still has to be classified before falling back to a generic fault.
      const errorMessage = safeResponseMessage(body);
      return {
        ok: false,
        reason: `Hanu OTP returned HTTP ${response.status}: ${errorMessage}`,
        invalidNumber: providerRejectedTheNumber(errorMessage),
      };
    }
    if (responseIsSuccessful(body)) return { ok: true, ...safeSuccessDetails(body) };

    const providerMessage = safeResponseMessage(body);
    return {
      ok: false,
      reason: `Hanu OTP error: ${providerMessage}`,
      invalidNumber: providerRejectedTheNumber(providerMessage),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid provider response";
    return {
      ok: false,
      reason: `Hanu OTP send failed: ${message}`,
      invalidNumber: false,
    };
  } finally {
    clearTimeout(timer);
  }
}