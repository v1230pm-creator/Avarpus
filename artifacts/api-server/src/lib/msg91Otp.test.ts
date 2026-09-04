import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMsg91OtpStatus, msg91SendOtp } from "./msg91Otp";

const ORIGINAL_AUTH_KEY = process.env["MSG91_AUTH_KEY"];
const ORIGINAL_TEMPLATE = process.env["MSG91_OTP_TEMPLATE_ID"];

beforeEach(() => {
  process.env["MSG91_AUTH_KEY"] = "test-msg91-key";
  process.env["MSG91_OTP_TEMPLATE_ID"] = "test-template";
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_AUTH_KEY === undefined) delete process.env["MSG91_AUTH_KEY"];
  else process.env["MSG91_AUTH_KEY"] = ORIGINAL_AUTH_KEY;
  if (ORIGINAL_TEMPLATE === undefined) delete process.env["MSG91_OTP_TEMPLATE_ID"];
  else process.env["MSG91_OTP_TEMPLATE_ID"] = ORIGINAL_TEMPLATE;
});

describe("msg91SendOtp", () => {
  it("sends the supplied OTP with international mobile format", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ type: "success", request_id: "request-123" })),
    );

    await expect(msg91SendOtp("9876543210", "123456")).resolves.toEqual({
      ok: true,
      providerMessage: "success",
      providerReference: "request-123",
    });

    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(calledUrl.origin + calledUrl.pathname).toBe(MSG91_TEST_ENDPOINT);
    expect(calledUrl.searchParams.get("mobile")).toBe("919876543210");
    expect(calledUrl.searchParams.get("otp")).toBe("123456");
    expect(calledUrl.searchParams.get("template_id")).toBe("test-template");
    expect(calledUrl.searchParams.get("authkey")).toBe("test-msg91-key");
  });

  it("fails closed for provider errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ type: "error", message: "Template not found" })),
    );
    await expect(msg91SendOtp("9876543210", "123456")).resolves.toEqual({
      ok: false,
      reason: "MSG91 error: Template not found",
    });
  });

  it("reports configuration without exposing credentials", () => {
    const status = getMsg91OtpStatus();
    expect(status.configured).toBe(true);
    expect(status.authKeyConfigured).toBe(true);
    expect(status.templateConfigured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("test-msg91-key");
    expect(JSON.stringify(status)).not.toContain("test-template");
  });
});

const MSG91_TEST_ENDPOINT = "https://control.msg91.com/api/v5/otp";