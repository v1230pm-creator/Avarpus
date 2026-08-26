import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

const mocks = vi.hoisted(() => ({
  authOtpRequest: vi.fn(),
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("@workspace/api-client-react", () => ({
  authOtpRequest: mocks.authOtpRequest,
}));

vi.mock("@/lib/auth", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ apiConfigurationError: null }),
}));

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState({}, "", "/login");
  sessionStorage.clear();
  mocks.authOtpRequest.mockReset();
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