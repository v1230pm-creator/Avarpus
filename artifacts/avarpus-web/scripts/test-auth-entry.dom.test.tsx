import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router as WouterRouter } from "wouter";
import App from "../src/App";
import { OtpPage } from "../src/pages/otp";

const mocks = vi.hoisted(() => ({
  authOtpRequest: vi.fn(),
  authOtpResend: vi.fn(),
  authOtpVerify: vi.fn(),
  setSession: vi.fn(),
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("@workspace/api-client-react", () => ({
  authOtpRequest: mocks.authOtpRequest,
  authOtpResend: mocks.authOtpResend,
  authOtpVerify: mocks.authOtpVerify,
}));

vi.mock("@/lib/auth", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    apiConfigurationError: null,
    setSession: mocks.setSession,
  }),
}));

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState({}, "", "/login");
  sessionStorage.clear();
  mocks.authOtpRequest.mockReset();
  mocks.authOtpResend.mockReset();
  mocks.authOtpVerify.mockReset();
  mocks.setSession.mockReset();
  root = createRoot(document.getElementById("root")!);
});

afterEach(() => {
  act(() => root.unmount());
});

describe("browser sign-in entry", () => {
  it("renders a usable mobile OTP form without retired sign-in actions", async () => {
    mocks.authOtpRequest.mockResolvedValue({});

    await act(async () => {
      root.render(<App />);
    });

    expect(window.location.pathname).toBe("/login");
    const form = document.querySelector<HTMLFormElement>("form.auth-form");
    const mobileInput = document.querySelector<HTMLInputElement>("#mobile-number");
    const consent = document.querySelector<HTMLButtonElement>('[role="checkbox"]');
    const continueButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Continue"),
    );

    expect(form).not.toBeNull();
    expect(document.querySelector("h1")?.textContent).toBe("Enter your mobile number");
    expect(mobileInput).not.toBeNull();
    expect(mobileInput?.type).toBe("tel");
    expect(mobileInput?.placeholder).toBe("10-digit mobile number");
    expect(consent).not.toBeNull();
    expect(consent?.getAttribute("aria-checked")).toBe("false");
    expect(continueButton).not.toBeNull();
    expect(continueButton?.disabled).toBe(false);

    await act(async () => {
      consent?.click();
    });
    expect(consent?.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      continueButton?.click();
    });
    expect(form?.querySelector('[role="alert"]')?.textContent).toContain(
      "valid 10-digit mobile number",
    );

    const interactiveLabels = [...document.querySelectorAll("button, a, input")]
      .map((element) => `${element.textContent} ${element.getAttribute("aria-label") ?? ""}`)
      .join(" ");
    expect(interactiveLabels).not.toMatch(/SIM verification|Verify with SIM/i);
    expect(interactiveLabels).not.toMatch(/SMS bridge/i);
    expect(interactiveLabels).not.toMatch(/device[- ]key|sign in with/i);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(mobileInput, "98765-43210");
      mobileInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(mobileInput?.value).toBe("9876543210");

    await act(async () => {
      continueButton?.click();
    });
    expect(mocks.authOtpRequest).toHaveBeenCalledWith({ mobile: "9876543210" });
    expect(window.location.pathname).toBe("/verify");
    expect(window.location.search).toBe("?mobile=9876543210");
  });
});


describe("browser OTP verification", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderOtpPage() {
    root.render(
      <WouterRouter>
        <OtpPage />
      </WouterRouter>,
    );
  }

  function setInputValue(input: HTMLInputElement, value: string) {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("renders the OTP action and reaches the authenticated destination after success", async () => {
    mocks.authOtpVerify.mockResolvedValue({
      token: "test-session-token",
      user: {
        id: "user-1",
        name: "Test User",
        email: "test@example.com",
        mobile: "9876543210",
        role: "dealer",
        isActive: true,
      },
    });
    window.history.replaceState({}, "", "/verify?mobile=9876543210");

    await act(async () => {
      renderOtpPage();
    });

    const form = document.querySelector<HTMLFormElement>("form.auth-form");
    const codeInput = document.querySelector<HTMLInputElement>("#verification-code");
    const verifyButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Verify & Continue"),
    );

    expect(window.location.pathname).toBe("/verify");
    expect(form).not.toBeNull();
    expect(codeInput?.inputMode).toBe("numeric");
    expect(codeInput?.autocomplete).toBe("one-time-code");
    expect(verifyButton).not.toBeNull();
    expect(verifyButton?.disabled).toBe(true);

    await act(async () => {
      setInputValue(codeInput!, "12a3456");
    });

    expect(codeInput?.value).toBe("123456");
    expect(verifyButton?.disabled).toBe(false);

    await act(async () => {
      verifyButton?.click();
    });

    expect(mocks.authOtpVerify).toHaveBeenCalledWith({
      mobile: "9876543210",
      code: "123456",
      rememberMe: true,
      deviceInfo: "Web Browser",
    });
    expect(mocks.setSession).toHaveBeenCalledWith("test-session-token");
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("shows an actionable error when the verification code is rejected", async () => {
    mocks.authOtpVerify.mockRejectedValue({
      data: { message: "Invalid verification code. Please try again." },
    });
    window.history.replaceState({}, "", "/verify?mobile=9876543210");

    await act(async () => {
      renderOtpPage();
    });

    const codeInput = document.querySelector<HTMLInputElement>("#verification-code");
    const verifyButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Verify & Continue"),
    );

    await act(async () => {
      setInputValue(codeInput!, "000000");
      verifyButton?.click();
    });

    expect(mocks.authOtpVerify).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/verify");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Invalid verification code. Please try again.",
    );
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it("explains an expired code and keeps resend available after cooldown", async () => {
    mocks.authOtpVerify.mockRejectedValue({
      data: { message: "Incorrect or expired code. Please try again." },
    });
    mocks.authOtpResend.mockResolvedValue({});
    window.history.replaceState({}, "", "/verify?mobile=9876543210");

    await act(async () => {
      renderOtpPage();
    });

    const codeInput = document.querySelector<HTMLInputElement>("#verification-code");
    const verifyButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Verify & Continue"),
    );

    await act(async () => {
      setInputValue(codeInput!, "123456");
      verifyButton?.click();
    });

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("verification code may have expired");
    expect(alert?.textContent).toContain("Resend code");
    expect(window.location.pathname).toBe("/verify");
    expect(mocks.setSession).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    const resendButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Resend code"),
    );
    expect(resendButton?.disabled).toBe(false);

    await act(async () => {
      resendButton?.click();
    });

    expect(mocks.authOtpResend).toHaveBeenCalledWith({ mobile: "9876543210" });
    expect(window.location.pathname).toBe("/verify");
  });

  it("keeps the verification screen available when resending fails after cooldown", async () => {
    mocks.authOtpResend.mockRejectedValue({
      data: { message: "Too many requests. Please wait and try again." },
    });
    window.history.replaceState({}, "", "/verify?mobile=9876543210");

    await act(async () => {
      renderOtpPage();
    });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    const resendButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Resend code"),
    );

    expect(resendButton).not.toBeNull();
    expect(resendButton?.disabled).toBe(false);
    expect(resendButton?.textContent).toBe("Resend code");

    await act(async () => {
      resendButton?.click();
    });

    expect(mocks.authOtpResend).toHaveBeenCalledWith({ mobile: "9876543210" });
    expect(window.location.pathname).toBe("/verify");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Too many requests. Please wait and try again.",
    );
    expect(document.querySelector("h1")?.textContent).toBe("Enter your verification code");
  });

  it("resets the resend cooldown after a successful resend", async () => {
    mocks.authOtpResend.mockResolvedValue({});
    window.history.replaceState({}, "", "/verify?mobile=9876543210");

    await act(async () => {
      renderOtpPage();
    });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    const resendButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Resend code"),
    );

    expect(resendButton?.disabled).toBe(false);

    await act(async () => {
      resendButton?.click();
    });

    expect(mocks.authOtpResend).toHaveBeenCalledWith({ mobile: "9876543210" });
    expect(resendButton?.disabled).toBe(true);
    expect(resendButton?.textContent).toBe("Resend code in 60s");
  });
});