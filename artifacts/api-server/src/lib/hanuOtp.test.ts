import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHanuOtpStatus, hanuSendOtp } from "./hanuOtp";

const ORIGINAL_API_KEY = process.env["HANU_OTP_API_KEY"];
const ORIGINAL_TEMPLATE_ID = process.env["HANU_OTP_TEMPLATE_ID"];

beforeEach(() => {
  process.env["HANU_OTP_API_KEY"] = "test-hanu-key";
  delete process.env["HANU_OTP_TEMPLATE_ID"];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (ORIGINAL_API_KEY === undefined) delete process.env["HANU_OTP_API_KEY"];
  else process.env["HANU_OTP_API_KEY"] = ORIGINAL_API_KEY;
  if (ORIGINAL_TEMPLATE_ID === undefined) delete process.env["HANU_OTP_TEMPLATE_ID"];
  else process.env["HANU_OTP_TEMPLATE_ID"] = ORIGINAL_TEMPLATE_ID;
});

describe("hanuSendOtp", () => {
  it("sends the country-coded Indian number, OTP, API key, and template to Hanu", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "success", message: "OTP sent" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(hanuSendOtp("9876543210", "123456")).resolves.toEqual({
      ok: true,
      providerMessage: "OTP sent",
      providerReference: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(calledUrl.origin + calledUrl.pathname).toBe("https://api.hanuotp.in/sms-otp.php");
    expect(calledUrl.searchParams.get("number")).toBe("919876543210");
    expect(calledUrl.searchParams.get("OTP")).toBe("123456");
    expect(calledUrl.searchParams.get("apikey")).toBe("test-hanu-key");
    expect(calledUrl.searchParams.get("templatesid")).toBe("default");
  });

  it.each([
    "OTP sent successfully",
    "OTP was not sent",
    "Failed to send OTP",
    "error: OTP sent status unavailable",
  ])("fails closed for ambiguous plain-text response: %s", async (body) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));
    const result = await hanuSendOtp("9876543210", "123456");
    expect(result.ok).toBe(false);
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

  it("accepts Hanu's documented return/message/request_id response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          return: true,
          request_id: "request-123",
          message: ["SMS OTP sent successfully."],
        }),
      ),
    );
    await expect(hanuSendOtp("9876543210", "123456")).resolves.toEqual({
      ok: true,
      providerMessage: "SMS OTP sent successfully.",
      providerReference: "request-123",
    });
    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(calledUrl.searchParams.get("number")).toBe("919876543210");
  });

  it("does not allow an environment override to redirect credentials", async () => {
    process.env["HANU_OTP_ENDPOINT"] = "https://user:password@api.hanuotp.in:444/sms-otp.php?token=secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "success" })),
    );
    await expect(hanuSendOtp("9876543210", "123456")).resolves.toEqual({
      ok: true,
      providerMessage: "success",
      providerReference: null,
    });
    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(calledUrl.origin + calledUrl.pathname).toBe("https://api.hanuotp.in/sms-otp.php");
    expect(calledUrl.username).toBe("");
    expect(calledUrl.password).toBe("");
    expect(calledUrl.port).toBe("");
    const status = getHanuOtpStatus();
    expect(status.endpoint).toBe("https://api.hanuotp.in/sms-otp.php");
    expect(JSON.stringify(status)).not.toContain("password");
    expect(JSON.stringify(status)).not.toContain("secret");
    delete process.env["HANU_OTP_ENDPOINT"];
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
      apiKeyConfigured: true,
    });
    expect(JSON.stringify(status)).not.toContain("test-hanu-key");
  });
});