const MSG91_OTP_ENDPOINT = "https://control.msg91.com/api/v5/otp";
const FETCH_TIMEOUT_MS = 10_000;

function authKey(): string | null {
  return process.env["MSG91_AUTH_KEY"]?.trim() || null;
}

function templateId(): string | null {
  return process.env["MSG91_OTP_TEMPLATE_ID"]?.trim() || null;
}

export type Msg91OtpResult =
  | { ok: true; providerMessage: string; providerReference: string | null }
  | { ok: false; reason: string };

export function getMsg91OtpStatus(): {
  provider: "MSG91";
  configured: boolean;
  endpoint: string;
  authKeyConfigured: boolean;
  templateConfigured: boolean;
} {
  return {
    provider: "MSG91",
    configured: Boolean(authKey() && templateId()),
    endpoint: MSG91_OTP_ENDPOINT,
    authKeyConfigured: Boolean(authKey()),
    templateConfigured: Boolean(templateId()),
  };
}

function safeMessage(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 160);
  if (body && typeof body === "object") {
    const data = body as Record<string, unknown>;
    for (const key of ["message", "type", "error"]) {
      if (typeof data[key] === "string" && data[key].trim()) {
        return data[key].slice(0, 160);
      }
    }
  }
  return "unknown MSG91 response";
}

export async function msg91SendOtp(
  local10: string,
  code: string,
): Promise<Msg91OtpResult> {
  const key = authKey();
  const template = templateId();
  if (!key || !template) {
    return { ok: false, reason: "MSG91 OTP credentials are not configured" };
  }

  const url = new URL(MSG91_OTP_ENDPOINT);
  url.searchParams.set("template_id", template);
  url.searchParams.set("mobile", `91${local10}`);
  url.searchParams.set("authkey", key);
  url.searchParams.set("otp", code);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "network error";
      return { ok: false, reason: `MSG91 OTP send failed: ${message}` };
    }

    const rawBody = await response.text();
    let body: unknown = rawBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      // Fail closed below for undocumented plain-text responses.
    }

    if (!response.ok) {
      return { ok: false, reason: `MSG91 returned HTTP ${response.status}` };
    }
    if (!body || typeof body !== "object") {
      return { ok: false, reason: `MSG91 error: ${safeMessage(body)}` };
    }
    const data = body as Record<string, unknown>;
    const type = typeof data["type"] === "string" ? data["type"].toLowerCase() : "";
    if (type !== "success") {
      return { ok: false, reason: `MSG91 error: ${safeMessage(body)}` };
    }
    const reference = data["request_id"] ?? data["requestId"];
    return {
      ok: true,
      providerMessage: safeMessage(body),
      providerReference:
        typeof reference === "string" || typeof reference === "number"
          ? String(reference).slice(0, 100)
          : null,
    };
  } finally {
    clearTimeout(timer);
  }
}