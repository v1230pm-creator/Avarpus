import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHanuOtpStatus, hanuSendOtp } from "./hanuOtp";

const ORIGINAL_API_KEY = process.env["HANU_OTP_API_KEY"];
const ORIGINAL_ENDPOINT = process.env["HANU_OTP_ENDPOINT"];
const ORIGINAL_TEMPLATE = process.env["HANU_OTP_TEMPLATE_ID"];

beforeEach(() => {
  process.env["HANU_OTP_API_KEY"] = "test-hanu-key";
  process.env["HANU_OTP_ENDPOINT"] = "https://api.hanuotp.in/sms-otp.php";
  process.env["HANU_OTP_TEMPLATE_ID"] = "default";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (ORIGINAL_API_KEY === undefined) delete process.env["HANU_OTP_API_KEY"];
  else process.env["HANU_OTP_API_KEY"] = ORIGINAL_API_KEY;
  if (ORIGINAL_ENDPOINT === undefined) delete process.env["HANU_OTP_ENDPOINT"];
  else process.env["HANU_OTP_ENDPOINT"] = ORIGINAL_ENDPOINT;
  if (ORIGINAL_TEMPLATE === undefined) delete process.env["HANU_OTP_TEMPLATE_ID"];
  else process.env["HANU_OTP_TEMPLATE_ID"] = ORIGINAL_TEMPLATE;
});

describe("hanuSendOtp", () => {
  it("sends the local Indian number, OTP, API key, and template to Hanu", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "success", message: "OTP sent" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(hanuSendOtp("9876543210", "123456")).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(calledUrl.origin + calledUrl.pathname).toBe("https://api.hanuotp.in/sms-otp.php");
    expect(calledUrl.searchParams.get("number")).toBe("9876543210");
    expect(calledUrl.searchParams.get("OTP")).toBe("123456");
    expect(calledUrl.searchParams.get("apikey")).toBe("test-hanu-key");
    expect(calledUrl.searchParams.get("templatesid")).toBe("default");
  });

  it("accepts Hanu plain-text success responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("OTP sent successfully"));
    await expect(hanuSendOtp("9876543210", "123456")).resolves.toEqual({ ok: true });
  });

  it("returns a sanitised failure for Hanu errors and malformed responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "error", message: "Invalid API Key" })),
    );
    await expect(hanuSendOtp("9876543210", "123456")).resolves.toEqual({
      ok: false,
      reason: "Hanu OTP error: Invalid API Key",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("<html>bad gateway</html>"));
    await expect(hanuSendOtp("9876543210", "123456")).resolves.toEqual({
      ok: false,
      reason: "Hanu OTP error: <html>bad gateway</html>",
    });
  });

  it("fails without making a request when the API key is missing", async () => {
    delete process.env["HANU_OTP_API_KEY"];
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(hanuSendOtp("9876543210", "123456")).resolves.toEqual({
      ok: false,
      reason: "HANU_OTP_API_KEY is not configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts a stalled Hanu request after ten seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    );

    const sending = hanuSendOtp("9876543210", "123456");
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(sending).resolves.toEqual({
      ok: false,
      reason: "Hanu OTP send failed: aborted",
    });
  });
});

describe("getHanuOtpStatus", () => {
  it("reports configuration without exposing the API key", () => {
    const status = getHanuOtpStatus();
    expect(status).toEqual({
      provider: "Hanu OTP",
      configured: true,
      endpoint: "https://api.hanuotp.in/sms-otp.php",
      templateId: "default",
      apiKeyConfigured: true,
    });
    expect(JSON.stringify(status)).not.toContain("test-hanu-key");
  });
});